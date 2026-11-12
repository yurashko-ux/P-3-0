// Каса: закриття візиту (послуги + товари + розбиття по рахунках), dual-write з Altegio.

import { prisma } from "@/lib/prisma";
import { fetchRecordPaymentState, type RecordPaymentState } from "@/lib/altegio/record-payments";
import {
  closeVisitInAltegio,
  resolveAltegioVisitId,
  buildVisitGoodsSale,
  fetchOtherVisitLines,
  type VisitCheckoutServiceLine,
} from "@/lib/altegio/visit-checkout-write";
import {
  closeVisitPaidFromDeposit,
  payVisitSaleFromDeposit,
  resolveVisitSaleDocumentId,
} from "@/lib/altegio/visit-deposit-pay";
import { fetchDepositsForClientIds } from "@/lib/altegio/client-deposits";
import { appendDepositSpend } from "@/lib/deposits/store";
import { searchWarehouseProducts } from "@/lib/warehouse/catalog";
import { createWriteOff } from "@/lib/warehouse/documents-kresco";
import { getUsdUahRate } from "@/lib/warehouse/fx";
import { getOrFixDailyFxRates } from "@/lib/fx/daily-rates";
import { resolveJournalCompanyId } from "./company-id";
import { isJournalAltegioImportEnabled, isJournalAltegioWriteSkipped } from "./altegio-write-gate";
import { hiddenFinanceAccountIds } from "@/lib/finance/account-archive";
import { altegioStorageIdForWrites } from "@/lib/warehouse/storages";
import { listPaymentAccounts } from "@/lib/finance/own-accounts";
import { ALTEGIO_MIRROR_PENDING, isAltegioMirrorPending, isCheckoutPaidInKresco } from "./altegio-mirror";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isDepositAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

export function isUsdCashAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /долар|usd|\b\$\b|dollar/.test(t);
}

/** Плитка «Євро» / EUR-каса — ввід у €, конвертація в грн за денним курсом. */
export function isEurCashAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /євро|евро|euro|\beur\b|€/.test(t);
}

export type CheckoutServiceLineInput = {
  lineId?: string;
  altegioServiceId: number;
  title?: string;
  amount?: number;
  cost: number;
};

export type CheckoutGoodLineInput = {
  productId: string;
  storageId: string;
  quantity: number;
  salePrice: number;
  title?: string;
};

export type CheckoutPaymentLineInput = {
  accountId: number;
  amount: number;
  paymentKind?: "account" | "deposit";
  depositId?: number | null;
  accountTitle?: string;
  /** Сума у валюті рахунку (напр. $) */
  amountFx?: number | null;
  currencyCode?: string | null;
  fxRate?: number | null;
};

export type CloseVisitInput = {
  appointmentId: string;
  services: CheckoutServiceLineInput[];
  goods?: CheckoutGoodLineInput[];
  /** Розбиття оплати (кілька рахунків / частково завдаток) */
  payments?: CheckoutPaymentLineInput[];
  /** Legacy: один рахунок каси/ФОП */
  accountId?: number;
  accountTitle?: string;
  /** Legacy: оплата лише з завдатку */
  depositId?: number | null;
  comment?: string;
  createdBy?: string | null;
};

type NormalizedPayment = {
  accountId: number;
  amount: number;
  paymentKind: "account" | "deposit";
  depositId: number | null;
  accountTitle: string;
  amountFx: number | null;
  currencyCode: string | null;
  fxRate: number | null;
};

const checkoutInclude = {
  payments: true,
  goodLines: true,
} as const;

export async function getCheckoutContext(appointmentId: string, catalogSearch?: string) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      lines: true,
      goodLines: true,
      checkout: { include: checkoutInclude },
      directClient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          phone: true,
          spent: true,
          visits: true,
        },
      },
      master: { select: { id: true, name: true } },
    },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");

  const [accountsAll, hiddenAccountIds] = await Promise.all([
    listPaymentAccounts(),
    hiddenFinanceAccountIds(),
  ]);
  const accounts = accountsAll
    .filter((a) => !isDepositAccountTitle(a.title) && !hiddenAccountIds.has(Number(a.id) || 0))
    .map((a) => ({
      id: Number(a.id),
      title: a.title,
      type: a.type,
    }))
    .filter((a) => a.id > 0);

  const storages = await prisma.warehouseStorage.findMany({
    where: { isActive: true },
    select: { id: true, title: true, altegioStorageId: true, includeInFinanceReport: true },
    orderBy: { title: "asc" },
  });

  let catalogProducts: Awaited<ReturnType<typeof searchWarehouseProducts>> = [];
  const q = String(catalogSearch || "").trim();
  if (q.length >= 1) {
    catalogProducts = await searchWarehouseProducts(q, 30);
  }

  type DepositOpt = {
    depositId: number;
    balance: number;
    title: string;
    blocked: boolean;
  };
  let clientDeposits: DepositOpt[] = [];
  const altegioClientId = Number(appointment.altegioClientId) || 0;
  if (altegioClientId > 0) {
    try {
      const dep = await fetchDepositsForClientIds({ clientIds: [altegioClientId] });
      clientDeposits = (dep.deposits || [])
        .filter((d) => d.depositId > 0)
        .map((d) => ({
          depositId: d.depositId,
          balance: toMoney(d.balance),
          title: d.depositTypeTitle || "Особистий рахунок",
          blocked: Boolean(d.blocked),
        }))
        .sort((a, b) => b.balance - a.balance);
    } catch (err) {
      console.warn(
        `[journal/checkout] Не вдалося завантажити завдатки client=${altegioClientId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  let altegioPaid = 0;
  let altegioPayments: Array<{ amount: number; date: string | null }> = [];
  if (appointment.altegioRecordId && appointment.altegioRecordId > 0) {
    const state = await fetchRecordPaymentState(
      Number(resolveJournalCompanyId()),
      appointment.altegioRecordId,
    );
    if (state?.paidFull && state.total > 0) {
      altegioPayments = [{ amount: state.total, date: null }];
      altegioPaid = state.total;
    }
  }

  const servicesSum = toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0));
  const goodsFromAppt = toMoney(
    (appointment.goodLines || []).reduce(
      (s, g) => s + (Number(g.salePrice) || 0) * (Number(g.quantity) || 0),
      0,
    ),
  );
  const goodsFromCheckout = toMoney(
    (appointment.checkout?.goodLines || []).reduce(
      (s, g) => s + (Number(g.salePrice) || 0) * (Number(g.quantity) || 0),
      0,
    ),
  );
  const goodsSum = goodsFromAppt > 0 ? goodsFromAppt : goodsFromCheckout;
  const expectedTotal =
    appointment.checkout?.paidAmount != null && appointment.checkout.paidAmount > 0
      ? toMoney(appointment.checkout.paidAmount)
      : toMoney(servicesSum + goodsSum);

  const fx = await getUsdUahRate();
  const eurWorking =
    fx.eurWorking != null && Number(fx.eurWorking) > 0 ? Number(fx.eurWorking) : null;

  console.log(
    `[journal/checkout] Курси каси: USD=${fx.rate ?? "—"} (${fx.source}), EUR=${eurWorking ?? "—"}`,
  );

  return {
    appointment,
    accounts,
    storages,
    catalogProducts,
    clientDeposits,
    altegioPaid,
    altegioPayments,
    usdRate: fx.rate,
    usdRateSource: fx.source,
    /** Денний робочий EUR/UAH (sell→ceil+1); без live Mono на кожен клік. */
    eurRate: eurWorking,
    eurRateSource: eurWorking != null ? fx.source : "none",
    /** Оплачено в Kresco, але дубль в Altegio не пройшов — касир може повторити його. */
    mirrorPending: isAltegioMirrorPending(appointment.checkout),
    alreadyPaid:
      isCheckoutPaidInKresco(appointment.checkout) ||
      (altegioPaid > 0 && expectedTotal > 0 && altegioPaid + 0.009 >= expectedTotal),
  };
}

/** Підхопити оплату з Altegio без зворотного write. */
export async function upsertCheckoutFromAltegioPayments(params: {
  appointmentId: string;
  altegioRecordId: number;
  altegioVisitId?: number | null;
  kyivDay: string;
}) {
  if (!isJournalAltegioImportEnabled()) return null;
  const state = await fetchRecordPaymentState(Number(resolveJournalCompanyId()), params.altegioRecordId);
  if (!state) return null;

  // Список записів Altegio не віддає цін — беремо суми з картки запису. Рядки Kresco не чіпаємо.
  const importedAppointment = await prisma.salonAppointment.findUnique({
    where: { id: params.appointmentId },
    select: { source: true },
  });
  if (importedAppointment?.source !== "kresco") {
    for (const service of state.services) {
      if (service.cost > 0) {
        await prisma.salonAppointmentLine.updateMany({
          where: {
            appointmentId: params.appointmentId,
            altegioServiceId: service.id,
            cost: { not: service.cost },
          },
          data: { cost: service.cost },
        });
      }
    }
  }
  if (!state.paidFull || !(state.total > 0)) return null;

  // Кілька майстрів в одному візиті: товари рахуємо один раз, на першому записі.
  const earlierInVisit = params.altegioVisitId
    ? await prisma.salonAppointment.findFirst({
        where: {
          altegioVisitId: params.altegioVisitId,
          altegioRecordId: { lt: params.altegioRecordId },
          status: { not: "deleted" },
        },
        select: { id: true },
      })
    : null;
  const totalGoods = earlierInVisit ? 0 : state.goodsTotal;
  const paidAmount = toMoney(state.servicesTotal + totalGoods);
  if (!(paidAmount > 0)) return null;
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: params.appointmentId },
    include: { lines: true, checkout: { include: checkoutInclude } },
  });
  if (!appointment) return null;

  const totalServices = toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0));
  const existing = appointment.checkout;

  // Чек Kresco не перезаписуємо і поки він pending: вебхук приходить ще під час закриття візиту.
  if (existing?.source === "kresco" && existing.paidAmount >= paidAmount - 0.01) {
    // Дубль не пройшов, а Altegio вже показує повну оплату — чек продубльовано.
    if (isAltegioMirrorPending(existing)) {
      console.log(`[journal/checkout] Чек ${existing.id}: оплата зʼявилась в Altegio — позначку знято`);
      return prisma.salonCheckout.update({
        where: { id: existing.id },
        data: { status: "synced", syncError: null },
        include: checkoutInclude,
      });
    }
    return existing;
  }

  const checkout = existing
    ? await prisma.salonCheckout.update({
        where: { id: existing.id },
        data: {
          altegioRecordId: params.altegioRecordId,
          altegioVisitId: params.altegioVisitId || existing.altegioVisitId,
          totalServices: state.servicesTotal,
          totalGoods,
          paidAmount,
          status: "synced",
          syncError: null,
          source: existing.source === "kresco" ? "kresco" : "altegio",
          kyivDay: params.kyivDay,
        },
      })
    : await prisma.salonCheckout.create({
        data: {
          appointmentId: params.appointmentId,
          altegioRecordId: params.altegioRecordId,
          altegioVisitId: params.altegioVisitId || null,
          totalServices: state.servicesTotal,
          totalGoods,
          paidAmount,
          status: "synced",
          source: "altegio",
          kyivDay: params.kyivDay,
        },
      });

  // Чек Kresco сюди не доходить: рядки товарів лише для імпортованих оплат.
  await replaceImportedGoodLines(checkout.id, earlierInVisit ? [] : state.goods, params.kyivDay);

  // Технічна оплата «Altegio» лише поки немає оплат по рахунках: з 08.11.2026 їх пише
  // syncCheckoutPaymentsFromFinance із фінансових операцій Altegio — їх не затираємо.
  const realPayments = await prisma.salonCheckoutPayment.count({
    where: { checkoutId: checkout.id, accountId: { gt: 0 }, altegioTransactionId: { not: null } },
  });
  if (realPayments === 0) {
    await prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: checkout.id } });
    await prisma.salonCheckoutPayment.create({
      data: {
        checkoutId: checkout.id,
        accountId: 0,
        accountTitle: "Altegio",
        amount: paidAmount,
      },
    });
  }

  if (appointment.attendance !== 1) {
    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: { attendance: 1 },
    });
  }

  console.log(
    `[journal/checkout] Upsert з Altegio appointment=${params.appointmentId} paid=${paidAmount}`,
  );
  return prisma.salonCheckout.findUnique({
    where: { id: checkout.id },
    include: checkoutInclude,
  });
}

/** Товари візиту з картки Altegio → рядки чека з собівартістю із картки товару. */
async function replaceImportedGoodLines(
  checkoutId: string,
  goods: RecordPaymentState["goods"],
  kyivDay: string,
) {
  await prisma.salonCheckoutGoodLine.deleteMany({ where: { checkoutId } });
  if (goods.length === 0) return;
  const [products, storages] = await Promise.all([
    prisma.warehouseProduct.findMany({
      where: { altegioGoodId: { in: goods.map((g) => g.goodId) } },
      select: { id: true, altegioGoodId: true, title: true, costPerUnit: true, isHair: true, costUsd: true },
    }),
    prisma.warehouseStorage.findMany({ where: { isActive: true } }),
  ]);
  const usdRate = await hairUsdRateForDay(kyivDay, products);
  const rows = [];
  for (const good of goods) {
    const product = products.find((p) => p.altegioGoodId === good.goodId);
    const storage = storages.find((s) => altegioStorageIdForWrites(s) === good.storageId);
    if (!product || !storage) {
      console.warn(
        `[journal/checkout] Товар Altegio ${good.goodId} (${good.title}) не знайдено на складі Kresco — рядок пропущено`,
      );
      continue;
    }
    rows.push({
      checkoutId,
      productId: product.id,
      storageId: storage.id,
      title: good.title || product.title,
      quantity: good.quantity,
      salePrice: toMoney(good.total / good.quantity),
      ...lineCostAtSale(product, usdRate),
      altegioGoodId: good.goodId,
    });
  }
  if (rows.length > 0) await prisma.salonCheckoutGoodLine.createMany({ data: rows });
}

type ProductCost = { title: string; costPerUnit: number; isHair: boolean; costUsd: number };

/**
 * Робочий курс USD дня продажу — лише коли серед товарів є волосся з ціною в $ (інакше без запиту до БД).
 * Якщо на цей день курс не зафіксовано — найближчий раніший.
 */
async function hairUsdRateForDay(kyivDay: string, products: ProductCost[]): Promise<number | null> {
  if (!products.some((p) => p.isHair && p.costUsd > 0)) return null;
  const daily = await getOrFixDailyFxRates(kyivDay).catch(() => null);
  if (daily && daily.usdWorking > 0) return daily.usdWorking;
  const earlier = await prisma.dailyFxRate.findFirst({
    where: { kyivDay: { lte: kyivDay } },
    orderBy: { kyivDay: "desc" },
    select: { kyivDay: true, usdWorking: true },
  });
  if (earlier && earlier.usdWorking > 0) {
    console.log(`[journal/checkout] Курс USD на ${kyivDay} не зафіксовано — беремо ${earlier.kyivDay}: ${earlier.usdWorking}`);
    return earlier.usdWorking;
  }
  console.warn(`[journal/checkout] Немає робочого курсу USD на ${kyivDay} — собівартість волосся лишається гривневою з картки`);
  return null;
}

/**
 * Собівартість рядка на момент продажу. Волосся з ціною в $: $ × робочий курс дня продажу,
 * і $ з курсом зберігаємо в рядку — щоб собівартість не змінювалась заднім числом.
 */
function lineCostAtSale(
  product: ProductCost,
  usdRate: number | null,
): { costPerUnit: number | null; costUsd: number | null; fxRateUsdUah: number | null } {
  if (product.isHair && product.costUsd > 0 && usdRate) {
    return { costPerUnit: toMoney(product.costUsd * usdRate), costUsd: product.costUsd, fxRateUsdUah: usdRate };
  }
  if (!(product.costPerUnit > 0)) {
    console.warn(`[journal/checkout] «${product.title}» продано без собівартості в картці`);
  }
  return { costPerUnit: product.costPerUnit > 0 ? product.costPerUnit : null, costUsd: null, fxRateUsdUah: null };
}

type NormalizedGood = {
  productId: string;
  storageId: string;
  title: string;
  quantity: number;
  salePrice: number;
  altegioGoodId: number;
  altegioStorageId: number;
  costPerUnit: number | null;
  /** Картка товару на момент продажу — для фіксації ціни в $ і курсу дня. */
  product: ProductCost;
  lineTotal: number;
};

async function normalizeGoods(raw: CheckoutGoodLineInput[] | undefined): Promise<NormalizedGood[]> {
  const rows = (raw || [])
    .map((g) => ({
      productId: String(g.productId || ""),
      storageId: String(g.storageId || ""),
      quantity: Number(g.quantity) || 0,
      salePrice: toMoney(Number(g.salePrice) || 0),
      title: typeof g.title === "string" ? g.title.trim() : "",
    }))
    .filter((g) => g.productId && g.storageId && g.quantity > 0 && g.salePrice >= 0);

  if (rows.length === 0) return [];

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const storageIds = [...new Set(rows.map((r) => r.storageId))];
  const [products, storages] = await Promise.all([
    prisma.warehouseProduct.findMany({ where: { id: { in: productIds } } }),
    prisma.warehouseStorage.findMany({ where: { id: { in: storageIds } } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const storageById = new Map(storages.map((s) => [s.id, s]));

  const out: NormalizedGood[] = [];
  for (const row of rows) {
    const product = productById.get(row.productId);
    if (!product) throw new Error(`Товар не знайдено (${row.productId})`);
    const storage = storageById.get(row.storageId);
    if (!storage) throw new Error(`Склад не знайдено (${row.storageId})`);
    // Склад лише в Kresco («Волосся») продає через свій склад Altegio для запису («Товари»).
    // Товар чи склад без id Altegio продаємо в Kresco; чек тоді лишається без дубля (0 = немає id).
    const altegioStorageId = altegioStorageIdForWrites(storage) || 0;
    if (!storage.isActive) throw new Error(`Склад «${storage.title}» вимкнено`);
    out.push({
      productId: product.id,
      storageId: storage.id,
      title: row.title || product.title,
      quantity: row.quantity,
      salePrice: row.salePrice,
      altegioGoodId: Number(product.altegioGoodId) || 0,
      altegioStorageId,
      costPerUnit: product.costPerUnit > 0 ? product.costPerUnit : null,
      product,
      lineTotal: toMoney(row.salePrice * row.quantity),
    });
  }
  return out;
}

async function replaceCheckoutGoodLines(checkoutId: string, goods: NormalizedGood[], kyivDay: string) {
  await prisma.salonCheckoutGoodLine.deleteMany({ where: { checkoutId } });
  if (goods.length === 0) return;
  const usdRate = await hairUsdRateForDay(kyivDay, goods.map((g) => g.product));
  await prisma.salonCheckoutGoodLine.createMany({
    data: goods.map((g) => ({
      checkoutId,
      productId: g.productId,
      storageId: g.storageId,
      title: g.title,
      quantity: g.quantity,
      salePrice: g.salePrice,
      ...lineCostAtSale(g.product, usdRate),
      altegioGoodId: g.altegioGoodId > 0 ? g.altegioGoodId : null,
    })),
  });
}

/** Списання зі складу після оплати; не дублює, якщо warehouseDocumentId уже є. */
async function writeOffGoodsForCheckout(params: {
  checkoutId: string;
  existingWarehouseDocumentId: string | null;
  goods: NormalizedGood[];
  clientLabel: string;
  kyivDay: string;
  createdBy?: string | null;
  localOnly?: boolean;
}): Promise<{ warehouseDocumentId: string | null; stockError: string | null }> {
  if (params.goods.length === 0) {
    return { warehouseDocumentId: params.existingWarehouseDocumentId, stockError: null };
  }
  if (params.existingWarehouseDocumentId) {
    console.log(
      `[journal/checkout] Списання вже є document=${params.existingWarehouseDocumentId} — skip`,
    );
    return { warehouseDocumentId: params.existingWarehouseDocumentId, stockError: null };
  }

  const byStorage = new Map<string, NormalizedGood[]>();
  for (const g of params.goods) {
    const list = byStorage.get(g.storageId) || [];
    list.push(g);
    byStorage.set(g.storageId, list);
  }

  const titleBase = `Каса ${params.clientLabel} ${params.kyivDay}`.slice(0, 80);
  let firstDocId: string | null = null;
  try {
    for (const [storageId, lines] of byStorage) {
      const doc = await createWriteOff({
        storageId,
        title: titleBase,
        createdBy: params.createdBy || null,
        parentDocumentId: firstDocId || undefined,
        localOnly: params.localOnly,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      });
      if (!firstDocId) firstDocId = doc.id;
      console.log(
        `[journal/checkout] Списання складу doc=${doc.id} storage=${storageId} lines=${lines.length}`,
      );
    }
    await prisma.salonCheckout.update({
      where: { id: params.checkoutId },
      data: { warehouseDocumentId: firstDocId },
    });
    return { warehouseDocumentId: firstDocId, stockError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[journal/checkout] Помилка списання складу checkout=${params.checkoutId}:`, message);
    return { warehouseDocumentId: null, stockError: `Склад: ${message}` };
  }
}

export async function closeVisitFromKresco(input: CloseVisitInput) {
  const loadAppointment = () =>
    prisma.salonAppointment.findUnique({
      where: { id: input.appointmentId },
      include: {
        lines: true,
        checkout: { include: checkoutInclude },
        directClient: { select: { firstName: true, lastName: true, instagramUsername: true } },
      },
    });
  let appointment = await loadAppointment();
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");
  // Перемикач вимкнув запис в Altegio — працюємо лише в Kresco, як і раніше.
  const gateSkipped = isJournalAltegioWriteSkipped();
  // Чому чек не дублюється в Altegio. Kresco зберігає його завжди; з позначкою, якщо дубль не пройшов.
  let mirrorIssue: string | null = null;
  if (!gateSkipped && !(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
    // Запис лишився лише в Kresco — спершу пробуємо продублювати його.
    const { pushAppointmentToAltegio } = await import("./index");
    const pushed = await pushAppointmentToAltegio(appointment.id);
    appointment = (await loadAppointment())!;
    if (!(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
      mirrorIssue = pushed.error || "запису немає в Altegio";
    }
  }

  const services = (input.services || [])
    .map((s) => ({
      lineId: s.lineId,
      altegioServiceId: Number(s.altegioServiceId) || 0,
      title: s.title,
      amount: Number(s.amount) > 0 ? Number(s.amount) : 1,
      cost: toMoney(Number(s.cost) || 0),
    }))
    // Kresco-only послуги не мають Altegio id — у чеку лишаємо їх за lineId/title
    .filter((s) => (s.altegioServiceId > 0 || Boolean(s.lineId) || Boolean(s.title)) && s.cost >= 0);

  if (services.length === 0) throw new Error("Додайте хоча б одну послугу");

  const unmapped = services.filter((s) => !(s.altegioServiceId > 0));
  if (!gateSkipped && !mirrorIssue && unmapped.length > 0) {
    mirrorIssue = `послуга без звʼязку з Altegio: ${unmapped.map((s) => s.title || "без назви").join(", ")}`;
  }

  const goods = await normalizeGoods(input.goods);
  const goodsWithoutAltegio = goods.filter((g) => !(g.altegioGoodId > 0) || !(g.altegioStorageId > 0));
  if (!gateSkipped && !mirrorIssue && goodsWithoutAltegio.length > 0) {
    mirrorIssue = `товар без id Altegio: ${goodsWithoutAltegio.map((g) => g.title).join(", ")}`;
  }
  // Далі skipAltegioWrite = «в Altegio не пишемо»: вимкнено перемикачем або дубль неможливий.
  let skipAltegioWrite = gateSkipped || Boolean(mirrorIssue);
  const totalServices = toMoney(services.reduce((s, l) => s + l.cost, 0));
  const totalGoods = toMoney(goods.reduce((s, g) => s + g.lineTotal, 0));
  const paidAmount = toMoney(totalServices + totalGoods);
  if (!(paidAmount > 0)) throw new Error("Сума чека має бути більше 0");

  const altegioClientId = Number(appointment.altegioClientId) || 0;
  const accounts = await listPaymentAccounts();

  let paymentLines: NormalizedPayment[] = [];

  if (Array.isArray(input.payments) && input.payments.length > 0) {
    paymentLines = input.payments
      .map((p) => {
        const amount = toMoney(Number(p.amount) || 0);
        const kind: "account" | "deposit" =
          p.paymentKind === "deposit" || Number(p.depositId) > 0 ? "deposit" : "account";
        const depositId = kind === "deposit" ? Number(p.depositId || p.accountId) || 0 : 0;
        const accountId = kind === "deposit" ? depositId : Number(p.accountId) || 0;
        const currencyCode = String(p.currencyCode || "").trim().toUpperCase() || null;
        const amountFx =
          p.amountFx != null && Number(p.amountFx) > 0 ? toMoney(Number(p.amountFx)) : null;
        const fxRate = p.fxRate != null && Number(p.fxRate) > 0 ? Number(p.fxRate) : null;
        return {
          accountId,
          amount,
          paymentKind: kind,
          depositId: kind === "deposit" ? depositId : null,
          accountTitle: String(p.accountTitle || "").trim(),
          amountFx,
          currencyCode,
          fxRate,
        };
      })
      .filter((p) => p.amount > 0 && p.accountId > 0);
  } else {
    // Legacy: один рахунок або один завдаток
    const legacyDepositId = Number(input.depositId) || 0;
    if (legacyDepositId > 0) {
      paymentLines = [
        {
          accountId: legacyDepositId,
          amount: paidAmount,
          paymentKind: "deposit",
          depositId: legacyDepositId,
          accountTitle: String(input.accountTitle || "").trim(),
          amountFx: null,
          currencyCode: null,
          fxRate: null,
        },
      ];
    } else {
      const accountId = Number(input.accountId) || 0;
      if (!(accountId > 0)) throw new Error("Оберіть рахунок оплати");
      paymentLines = [
        {
          accountId,
          amount: paidAmount,
          paymentKind: "account",
          depositId: null,
          accountTitle: String(input.accountTitle || "").trim(),
          amountFx: null,
          currencyCode: null,
          fxRate: null,
        },
      ];
    }
  }

  if (paymentLines.length === 0) throw new Error("Оберіть хоча б один рахунок оплати");

  const paymentsSum = toMoney(paymentLines.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paymentsSum - paidAmount) > 0.015) {
    throw new Error(
      `Сума платежів (${paymentsSum.toLocaleString("uk-UA")}) має дорівнювати чеку (${paidAmount.toLocaleString("uk-UA")} грн)`,
    );
  }

  const depositParts = paymentLines.filter((p) => p.paymentKind === "deposit");
  const accountParts = paymentLines.filter((p) => p.paymentKind === "account");

  if (depositParts.length > 1) {
    throw new Error("Один чек — один рядок завдатку (об'єднайте суму)");
  }

  let depositMeta: { depositId: number; title: string; balance: number } | null = null;
  if (depositParts.length > 0) {
    const depositId = depositParts[0].depositId!;
    // Залишки завдатків поки веде Altegio: без дубля завдаток списався б лише в Kresco.
    if (mirrorIssue) {
      throw new Error(`Оплата завдатком можлива лише з дублем в Altegio, а він зараз неможливий: ${mirrorIssue}`);
    }
    if (skipAltegioWrite) {
      depositMeta = {
        depositId,
        title: depositParts[0].accountTitle.replace(/^Завдаток:\s*/i, "") || "особистий рахунок",
        balance: depositParts[0].amount,
      };
      depositParts[0].accountTitle =
        depositParts[0].accountTitle || `Завдаток: ${depositMeta.title}`;
      depositParts[0].accountId = depositId;
    } else {
      if (!(altegioClientId > 0)) {
        throw new Error("Немає id клієнта Altegio — неможливо списати завдаток");
      }
      const dep = await fetchDepositsForClientIds({ clientIds: [altegioClientId] });
      const deposit = (dep.deposits || []).find((d) => d.depositId === depositId);
      if (!deposit) throw new Error("Завдаток клієнта не знайдено в Altegio");
      if (deposit.blocked) throw new Error("Особистий рахунок клієнта заблоковано");
      const balance = toMoney(deposit.balance);
      if (balance + 0.009 < depositParts[0].amount) {
        throw new Error(
          `Недостатньо на завдаткові: ${balance.toLocaleString("uk-UA")} грн, потрібно ${depositParts[0].amount.toLocaleString("uk-UA")} грн`,
        );
      }
      depositMeta = {
        depositId,
        title: deposit.depositTypeTitle || "особистий рахунок",
        balance,
      };
      depositParts[0].accountTitle =
        depositParts[0].accountTitle || `Завдаток: ${depositMeta.title}`;
      depositParts[0].accountId = depositId;
    }
  }

  const hiddenAccountIds = await hiddenFinanceAccountIds();
  for (const part of accountParts) {
    if (hiddenAccountIds.has(part.accountId)) {
      throw new Error(`Рахунок «${part.accountTitle || part.accountId}» в архіві`);
    }
    const account = accounts.find((a) => Number(a.id) === part.accountId);
    if (!account && !part.accountTitle) {
      throw new Error(`Рахунок #${part.accountId} не знайдено`);
    }
    if (account && isDepositAccountTitle(account.title)) {
      throw new Error("Для завдатку оберіть плитку завдатку клієнта, а не касовий рахунок");
    }
    part.accountTitle = part.accountTitle || account?.title || `Рахунок #${part.accountId}`;
  }

  const hasDepositPart = depositParts.length === 1;
  /** Дубль не пройшов: чек із завдатком зупиняємо, решту зберігаємо в Kresco з позначкою. */
  const mirrorFailed = (reason: string) => {
    if (hasDepositPart) throw new Error(reason);
    mirrorIssue = reason;
    skipAltegioWrite = true;
  };

  const clientLabel =
    [appointment.directClient?.lastName, appointment.directClient?.firstName].filter(Boolean).join(" ") ||
    appointment.clientName ||
    appointment.directClient?.instagramUsername ||
    "клієнт";

  // Ідемпотентність: уже оплачено на повну суму в Altegio або в Kresco.
  let altegioPaid = 0;
  if (!skipAltegioWrite && appointment.altegioRecordId && appointment.altegioRecordId > 0) {
    const state = await fetchRecordPaymentState(
      Number(resolveJournalCompanyId()),
      appointment.altegioRecordId,
    );
    if (!state) mirrorFailed("Не вдалося перевірити оплату в Altegio — спробуйте ще раз");
    else if (state.paidFull) {
      altegioPaid = Math.max(state.total, paidAmount);
    } else if (state.paidPartially) {
      // Суми часткової оплати картка не дає. Після нашого збою це каса; інакше блокуємо закриття.
      altegioPaid = appointment.checkout?.status === "sync_error"
        ? toMoney(accountParts.reduce((s, p) => s + p.amount, 0))
        : 0.01;
    }
  }

  const alreadyFullyPaid =
    (appointment.checkout?.status === "synced" &&
      appointment.checkout.paidAmount + 0.009 >= paidAmount) ||
    (!skipAltegioWrite && altegioPaid + 0.009 >= paidAmount);

  if (alreadyFullyPaid) {
    if (skipAltegioWrite || !(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
      console.log(
        `[journal/checkout] Ідемпотентний skip (Kresco) — уже оплачено ${appointment.checkout?.paidAmount}`,
      );
      return appointment.checkout
        ? prisma.salonCheckout.findUnique({
            where: { id: appointment.checkout.id },
            include: checkoutInclude,
          })
        : null;
    }
    let synced = await upsertCheckoutFromAltegioPayments({
      appointmentId: appointment.id,
      altegioRecordId: appointment.altegioRecordId,
      altegioVisitId: appointment.altegioVisitId,
      kyivDay: appointment.kyivDay,
    });
    // В Altegio вже оплачено повністю, а чек Kresco лишився після збою — завершуємо його.
    if (synced && synced.status !== "synced") {
      synced = await prisma.salonCheckout.update({
        where: { id: synced.id },
        data: { status: "synced", syncError: null },
        include: checkoutInclude,
      });
    }
    // Добити списання, якщо оплата є, а складу ще немає.
    if (goods.length > 0 && synced && !synced.warehouseDocumentId) {
      const stock = await writeOffGoodsForCheckout({
        checkoutId: synced.id,
        existingWarehouseDocumentId: null,
        goods,
        clientLabel,
        kyivDay: appointment.kyivDay,
        createdBy: input.createdBy,
        localOnly: true,
      });
      if (stock.stockError) {
        await prisma.salonCheckout.update({
          where: { id: synced.id },
          data: { syncError: stock.stockError },
        });
      }
      return prisma.salonCheckout.findUnique({
        where: { id: synced.id },
        include: checkoutInclude,
      });
    }
    console.log(
      `[journal/checkout] Ідемпотентний skip — уже оплачено ${altegioPaid || appointment.checkout?.paidAmount}`,
    );
    return synced;
  }

  // Часткову оплату картка запису не показує (payment_status лишається 0), тому після збою
  // не відновлюємо автоматично: повтор міг би задвоїти касову частину.
  if (
    !skipAltegioWrite &&
    appointment.checkout?.status === "sync_error" &&
    depositParts.length === 1 &&
    accountParts.length > 0
  ) {
    throw new Error("Попереднє закриття не завершилось — перевірте оплату в Altegio перед повтором");
  }

  // Повтор після збою: каса в Altegio вже пройшла, лишилось списати завдаток.
  const accountPartsSum = toMoney(accountParts.reduce((s, p) => s + p.amount, 0));
  const resumeDepositOnly =
    depositParts.length === 1 && accountParts.length > 0 && altegioPaid + 0.009 >= accountPartsSum;
  if (altegioPaid > 0.009 && !resumeDepositOnly) {
    throw new Error(
      `В Altegio вже є оплата ${altegioPaid.toLocaleString("uk-UA")} грн із ${paidAmount.toLocaleString("uk-UA")} — перевірте запис, щоб не задвоїти платіж`,
    );
  }

  let visitId = Number(appointment.altegioVisitId) || 0;
  if (!skipAltegioWrite) {
    if (!(visitId > 0) && appointment.altegioRecordId) {
      visitId = (await resolveAltegioVisitId(appointment.altegioRecordId)) || 0;
      if (visitId > 0) {
        await prisma.salonAppointment.update({
          where: { id: appointment.id },
          data: { altegioVisitId: visitId },
        });
      }
    }
    if (!(visitId > 0)) {
      mirrorFailed("Немає visit_id Altegio — неможливо провести оплату через /visits");
    }
  }

  for (const s of services) {
    if (s.lineId) {
      await prisma.salonAppointmentLine.updateMany({
        where: { id: s.lineId, appointmentId: appointment.id },
        data: { cost: s.cost, amount: s.amount },
      });
    } else {
      await prisma.salonAppointmentLine.updateMany({
        where: { appointmentId: appointment.id, altegioServiceId: s.altegioServiceId },
        data: { cost: s.cost, amount: s.amount },
      });
    }
  }

  const paymentCreate = paymentLines.map((p) => ({
    accountId: p.accountId,
    accountTitle: p.accountTitle || null,
    amount: p.amount,
    paymentKind: p.paymentKind,
    amountFx: p.amountFx,
    currencyCode: p.currencyCode,
    fxRate: p.fxRate,
  }));

  let pendingId = appointment.checkout?.id;
  if (!pendingId) {
    const created = await prisma.salonCheckout.create({
      data: {
        appointmentId: appointment.id,
        altegioRecordId: appointment.altegioRecordId,
        altegioVisitId: visitId,
        totalServices,
        totalGoods,
        paidAmount,
        status: "pending",
        source: "kresco",
        kyivDay: appointment.kyivDay,
        payments: { create: paymentCreate },
      },
    });
    pendingId = created.id;
  } else {
    await prisma.salonCheckout.update({
      where: { id: pendingId },
      data: {
        altegioRecordId: appointment.altegioRecordId,
        altegioVisitId: visitId,
        totalServices,
        totalGoods,
        paidAmount,
        status: "pending",
        syncError: null,
        source: "kresco",
        kyivDay: appointment.kyivDay,
      },
    });
    await prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: pendingId } });
    await prisma.salonCheckoutPayment.createMany({
      data: paymentCreate.map((p) => ({ ...p, checkoutId: pendingId! })),
    });
  }

  await replaceCheckoutGoodLines(pendingId, goods, appointment.kyivDay);

  const hasDeposit = depositParts.length === 1;
  const depositAmount = hasDeposit ? depositParts[0].amount : 0;
  const depositId = hasDeposit ? depositParts[0].depositId! : 0;

  try {
    let transactionIds: number[] = [];
    let documentId: number | null = null;

    if (skipAltegioWrite) {
      console.log(
        `[journal/checkout] Оплата ${pendingId} лише в Kresco (${mirrorIssue || "JOURNAL_SKIP_ALTEGIO_WRITE"}), parts=${paymentLines.map((p) => `${p.paymentKind}:${p.accountId}=${p.amount}`).join(",")}`,
      );
    } else {
      try {
        const servicePayload: VisitCheckoutServiceLine[] = services
          .filter((s) => s.altegioServiceId > 0)
          .map((s) => ({
          id: s.altegioServiceId,
          amount: s.amount,
          firstCost: s.cost,
          cost: s.cost,
          discount: 0,
          title: s.title,
          recordId: appointment.altegioRecordId!,
        }));

        const otherVisit = await fetchOtherVisitLines(visitId, appointment.altegioRecordId!);
        if (otherVisit.services.length > 0) {
          console.log(
            `[journal/checkout] Візит ${visitId}: додаємо ${otherVisit.services.length} послуг інших записів`,
          );
          servicePayload.push(...otherVisit.services);
        }
        // Товар іде продажем у візиті: сума чека й списання складу в Altegio з одного рядка.
        const goodsTransactions = [
          ...otherVisit.goods,
          ...goods.map((g) =>
            buildVisitGoodsSale({
              goodId: g.altegioGoodId,
              storageId: g.altegioStorageId,
              quantity: g.quantity,
              unitPrice: g.salePrice,
              masterId: appointment.altegioStaffId,
            }),
          ),
        ];

        if (servicePayload.length === 0 && !skipAltegioWrite) {
          console.warn(
            `[journal/checkout] Немає Altegio service id у чеку ${pendingId} — оплату послуг у Altegio пропускаємо`,
          );
        }

        const onlyDeposit = depositParts.length === 1 && accountParts.length === 0;

        if (onlyDeposit) {
          const result = await closeVisitPaidFromDeposit({
            visitId,
            recordId: appointment.altegioRecordId!,
            attendance: 1,
            comment: input.comment ?? appointment.comment ?? "",
            services: servicePayload,
            goodsTransactions,
            depositId,
            amount: depositAmount,
          });
          transactionIds = result.transactionIds;
          documentId = result.documentId;
        } else if (!hasDeposit) {
          const result = await closeVisitInAltegio({
            visitId,
            recordId: appointment.altegioRecordId!,
            attendance: 1,
            comment: input.comment ?? appointment.comment ?? "",
            services: servicePayload,
            payments: accountParts.map((p) => ({ accountId: p.accountId, amount: p.amount })),
            goodsTransactions,
          });
          transactionIds = result.transactionIds;
          documentId = await resolveVisitSaleDocumentId({
            visitId,
            recordId: appointment.altegioRecordId!,
            putRaw: result.raw,
          });
        } else {
          // Каса/ФОП + завдаток: спочатку касові new_transactions, потім sale/payment deposit
          const result = resumeDepositOnly
            ? null
            : await closeVisitInAltegio({
                visitId,
                recordId: appointment.altegioRecordId!,
                attendance: 1,
                comment: input.comment ?? appointment.comment ?? "",
                services: servicePayload,
                payments: accountParts.map((p) => ({ accountId: p.accountId, amount: p.amount })),
                goodsTransactions,
              });
          transactionIds = [...(result?.transactionIds || [])];
          documentId = await resolveVisitSaleDocumentId({
            visitId,
            recordId: appointment.altegioRecordId!,
            putRaw: result?.raw,
          });
          if (!(documentId && documentId > 0)) {
            throw new Error("Не вдалося визначити document_id для часткової оплати з завдатку");
          }
          const depPay = await payVisitSaleFromDeposit({
            documentId,
            depositId,
            amount: depositAmount,
          });
          transactionIds = [...transactionIds, ...depPay.transactionIds];
        }
      } catch (altegioErr) {
        const reason = altegioErr instanceof Error ? altegioErr.message : String(altegioErr);
        console.error(`[journal/checkout] Дубль оплати ${pendingId} в Altegio не пройшов:`, reason);
        // Без завдатку гроші вже в касі салону: чек лишається в Kresco, дубль повторить касир.
        mirrorFailed(reason);
      }
    }

    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: {
        attendance: 1,
        ...(visitId > 0 ? { altegioVisitId: visitId } : {}),
      },
    });

    let depositAccountId: string | null = null;
    if (hasDeposit && depositMeta && altegioClientId > 0) {
      try {
        const spend = await appendDepositSpend({
          altegioClientId,
          altegioDepositId: depositId,
          amount: depositAmount,
          appointmentId: appointment.id,
          checkoutId: pendingId,
          directClientId: appointment.directClientId,
          altegioDocumentId: documentId,
          altegioPaymentTxId: transactionIds[transactionIds.length - 1] || null,
          kyivDay: appointment.kyivDay,
          comment: `Оплата візиту з завдатку`,
          title: depositMeta.title,
          createdBy: input.createdBy,
        });
        depositAccountId = spend.accountId;
      } catch (ledgerErr) {
        console.error(
          `[journal/checkout] Ledger spend не записано:`,
          ledgerErr instanceof Error ? ledgerErr.message : ledgerErr,
        );
      }
    }

    const existingDocId = appointment.checkout?.warehouseDocumentId || null;
    const stock = await writeOffGoodsForCheckout({
      checkoutId: pendingId,
      existingWarehouseDocumentId: existingDocId,
      goods,
      clientLabel,
      kyivDay: appointment.kyivDay,
      createdBy: input.createdBy,
      // В Altegio товар уже списаний продажем у візиті.
      localOnly: true,
    });

    await prisma.salonCheckout.update({
      where: { id: pendingId },
      data: {
        status: mirrorIssue ? "sync_error" : "synced",
        syncError: mirrorIssue
          ? `${ALTEGIO_MIRROR_PENDING}${mirrorIssue}${stock.stockError ? ` · ${stock.stockError}` : ""}`
          : skipAltegioWrite
            ? stock.stockError || "тест: оплата лише в Kresco"
            : stock.stockError,
        paidAmount,
        totalServices,
        totalGoods,
        ...(visitId > 0 ? { altegioVisitId: visitId } : {}),
        ...(stock.warehouseDocumentId ? { warehouseDocumentId: stock.warehouseDocumentId } : {}),
      },
    });

    const saved = await prisma.salonCheckout.findUnique({
      where: { id: pendingId },
      include: checkoutInclude,
    });
    if (saved?.payments?.length && transactionIds.length > 0) {
      // Проставляємо tx id по порядку: спочатку касові, потім завдаток
      let txIdx = 0;
      const ordered = [
        ...saved.payments.filter((p) => p.paymentKind !== "deposit"),
        ...saved.payments.filter((p) => p.paymentKind === "deposit"),
      ];
      for (const pay of ordered) {
        const txId = transactionIds[txIdx] || transactionIds[0] || null;
        txIdx++;
        await prisma.salonCheckoutPayment.update({
          where: { id: pay.id },
          data: {
            ...(txId ? { altegioTransactionId: txId } : {}),
            ...(pay.paymentKind === "deposit" && depositAccountId ? { depositAccountId } : {}),
          },
        });
      }
    }
    console.log(
      `[journal/checkout] ✅ Закрито appointment=${appointment.id} paid=${paidAmount} parts=${paymentLines.map((p) => `${p.paymentKind}:${p.accountId}=${p.amount}`).join(",")} goods=${totalGoods}${skipAltegioWrite ? " (Kresco-only)" : ""}`,
    );
    return prisma.salonCheckout.findUnique({
      where: { id: pendingId },
      include: checkoutInclude,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.salonCheckout.update({
      where: { id: pendingId },
      data: { status: "sync_error", syncError: message },
    });
    console.error(`[journal/checkout] Помилка закриття ${appointment.id}:`, message);
    throw new Error(message);
  }
}

/**
 * Повтор дубля в Altegio для чека, збереженого лише в Kresco. Лише вручну з вікна каси:
 * автоматичний повтор оплати міг би задвоїти платіж.
 */
export async function retryCheckoutAltegioMirror(appointmentId: string, createdBy?: string | null) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    include: { lines: true, checkout: { include: checkoutInclude } },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  const checkout = appointment.checkout;
  if (!checkout || !isAltegioMirrorPending(checkout)) {
    throw new Error("Цей чек не чекає на дубль в Altegio");
  }
  console.log(`[journal/checkout] Повтор дубля чека ${checkout.id} в Altegio`);
  return closeVisitFromKresco({
    appointmentId,
    services: appointment.lines.map((l) => ({
      lineId: l.id,
      altegioServiceId: l.altegioServiceId ?? undefined,
      title: l.title,
      amount: l.amount,
      cost: l.cost,
    })),
    goods: checkout.goodLines
      .filter((g) => g.productId && g.storageId)
      .map((g) => ({
        productId: g.productId as string,
        storageId: g.storageId as string,
        quantity: g.quantity,
        salePrice: g.salePrice,
        title: g.title,
      })),
    payments: checkout.payments.map((p) => ({
      accountId: p.accountId,
      accountTitle: p.accountTitle || undefined,
      amount: p.amount,
      paymentKind: p.paymentKind === "deposit" ? "deposit" : "account",
      amountFx: p.amountFx,
      currencyCode: p.currencyCode,
      fxRate: p.fxRate,
    })),
    createdBy: createdBy ?? undefined,
  });
}
