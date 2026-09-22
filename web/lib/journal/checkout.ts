// Каса: закриття візиту (послуги + товари + розбиття по рахунках), dual-write з Altegio.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { fetchTimetableTransactionsForRecord } from "@/lib/altegio/record-payments";
import {
  closeVisitInAltegio,
  resolveAltegioVisitId,
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
import { resolveJournalCompanyId } from "./company-id";
import { isJournalAltegioWriteSkipped } from "./altegio-write-gate";

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

  const accountsAll = await fetchAltegioAccounts();
  const accounts = accountsAll
    .filter((a) => !isDepositAccountTitle(a.title))
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
    const companyId = resolveJournalCompanyId();
    const txs = await fetchTimetableTransactionsForRecord(companyId, appointment.altegioRecordId);
    altegioPayments = txs
      .filter((t) => !t.deleted && t.amount > 0)
      .map((t) => ({ amount: t.amount, date: t.date }));
    altegioPaid = toMoney(altegioPayments.reduce((s, t) => s + t.amount, 0));
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
    alreadyPaid:
      appointment.checkout?.status === "synced" ||
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
  const companyId = resolveJournalCompanyId();
  const txs = await fetchTimetableTransactionsForRecord(companyId, params.altegioRecordId);
  const live = txs.filter((t) => !t.deleted && t.amount > 0);
  if (live.length === 0) return null;

  const paidAmount = toMoney(live.reduce((s, t) => s + t.amount, 0));
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: params.appointmentId },
    include: { lines: true, checkout: { include: checkoutInclude } },
  });
  if (!appointment) return null;

  const totalServices = toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0));
  const existing = appointment.checkout;
  const totalGoods = toMoney(existing?.totalGoods || 0);

  if (
    existing?.status === "synced" &&
    existing.source === "kresco" &&
    existing.paidAmount >= paidAmount - 0.01
  ) {
    return existing;
  }

  const checkout = existing
    ? await prisma.salonCheckout.update({
        where: { id: existing.id },
        data: {
          altegioRecordId: params.altegioRecordId,
          altegioVisitId: params.altegioVisitId || existing.altegioVisitId,
          totalServices: totalServices || Math.max(0, paidAmount - totalGoods),
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
          totalServices: totalServices || paidAmount,
          totalGoods: 0,
          paidAmount,
          status: "synced",
          source: "altegio",
          kyivDay: params.kyivDay,
        },
      });

  await prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: checkout.id } });
  for (const t of live) {
    await prisma.salonCheckoutPayment.create({
      data: {
        checkoutId: checkout.id,
        accountId: 0,
        accountTitle: "Altegio",
        amount: t.amount,
        altegioTransactionId: t.transactionId,
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
    `[journal/checkout] Upsert з Altegio appointment=${params.appointmentId} paid=${paidAmount} txs=${live.length}`,
  );
  return prisma.salonCheckout.findUnique({
    where: { id: checkout.id },
    include: checkoutInclude,
  });
}

type NormalizedGood = {
  productId: string;
  storageId: string;
  title: string;
  quantity: number;
  salePrice: number;
  altegioGoodId: number;
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
    if (!(product.altegioGoodId && product.altegioGoodId > 0)) {
      throw new Error(`«${product.title}» без id Altegio — спочатку синхронізуйте склад`);
    }
    const storage = storageById.get(row.storageId);
    if (!storage) throw new Error(`Склад не знайдено (${row.storageId})`);
    if (!(storage.altegioStorageId && storage.altegioStorageId > 0)) {
      throw new Error(`Склад «${storage.title}» без id Altegio`);
    }
    if (!storage.isActive) throw new Error(`Склад «${storage.title}» вимкнено`);
    out.push({
      productId: product.id,
      storageId: storage.id,
      title: row.title || product.title,
      quantity: row.quantity,
      salePrice: row.salePrice,
      altegioGoodId: product.altegioGoodId,
      lineTotal: toMoney(row.salePrice * row.quantity),
    });
  }
  return out;
}

async function replaceCheckoutGoodLines(checkoutId: string, goods: NormalizedGood[]) {
  await prisma.salonCheckoutGoodLine.deleteMany({ where: { checkoutId } });
  if (goods.length === 0) return;
  await prisma.salonCheckoutGoodLine.createMany({
    data: goods.map((g) => ({
      checkoutId,
      productId: g.productId,
      storageId: g.storageId,
      title: g.title,
      quantity: g.quantity,
      salePrice: g.salePrice,
      altegioGoodId: g.altegioGoodId,
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
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: input.appointmentId },
    include: {
      lines: true,
      checkout: { include: checkoutInclude },
      directClient: { select: { firstName: true, lastName: true, instagramUsername: true } },
    },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");
  const skipAltegioWrite =
    isJournalAltegioWriteSkipped() || !(appointment.altegioRecordId && appointment.altegioRecordId > 0);
  if (!skipAltegioWrite && !(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
    throw new Error("Запис ще не має id Altegio — спочатку синхронізуйте журнал");
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

  const goods = await normalizeGoods(input.goods);
  const totalServices = toMoney(services.reduce((s, l) => s + l.cost, 0));
  const totalGoods = toMoney(goods.reduce((s, g) => s + g.lineTotal, 0));
  const paidAmount = toMoney(totalServices + totalGoods);
  if (!(paidAmount > 0)) throw new Error("Сума чека має бути більше 0");

  const altegioClientId = Number(appointment.altegioClientId) || 0;
  const accounts = await fetchAltegioAccounts();

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

  for (const part of accountParts) {
    const account = accounts.find((a) => Number(a.id) === part.accountId);
    if (!account && !part.accountTitle) {
      throw new Error(`Рахунок Altegio #${part.accountId} не знайдено`);
    }
    if (account && isDepositAccountTitle(account.title)) {
      throw new Error("Для завдатку оберіть плитку завдатку клієнта, а не касовий рахунок");
    }
    part.accountTitle = part.accountTitle || account?.title || `Рахунок #${part.accountId}`;
  }

  const clientLabel =
    [appointment.directClient?.lastName, appointment.directClient?.firstName].filter(Boolean).join(" ") ||
    appointment.clientName ||
    appointment.directClient?.instagramUsername ||
    "клієнт";

  // Ідемпотентність: уже оплачено на повну суму в Altegio або в Kresco.
  let altegioPaid = 0;
  if (!skipAltegioWrite && appointment.altegioRecordId && appointment.altegioRecordId > 0) {
    const companyId = resolveJournalCompanyId();
    const existingTxs = await fetchTimetableTransactionsForRecord(companyId, appointment.altegioRecordId);
    altegioPaid = toMoney(
      existingTxs.filter((t) => !t.deleted && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    );
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
    const synced = await upsertCheckoutFromAltegioPayments({
      appointmentId: appointment.id,
      altegioRecordId: appointment.altegioRecordId,
      altegioVisitId: appointment.altegioVisitId,
      kyivDay: appointment.kyivDay,
    });
    // Добити списання, якщо оплата є, а складу ще немає.
    if (goods.length > 0 && synced && !synced.warehouseDocumentId) {
      const stock = await writeOffGoodsForCheckout({
        checkoutId: synced.id,
        existingWarehouseDocumentId: null,
        goods,
        clientLabel,
        kyivDay: appointment.kyivDay,
        createdBy: input.createdBy,
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
      throw new Error("Немає visit_id Altegio — неможливо провести оплату через /visits");
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

  await replaceCheckoutGoodLines(pendingId, goods);

  const hasDeposit = depositParts.length === 1;
  const depositAmount = hasDeposit ? depositParts[0].amount : 0;
  const depositId = hasDeposit ? depositParts[0].depositId! : 0;

  try {
    let transactionIds: number[] = [];
    let documentId: number | null = null;

    if (skipAltegioWrite) {
      console.log(
        `[journal/checkout] JOURNAL_SKIP_ALTEGIO_WRITE: оплата ${pendingId} лише в Kresco, parts=${paymentLines.map((p) => `${p.paymentKind}:${p.accountId}=${p.amount}`).join(",")}`,
      );
    } else {
      const servicePayload = services
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
        });
        transactionIds = result.transactionIds;
        documentId = await resolveVisitSaleDocumentId({
          visitId,
          recordId: appointment.altegioRecordId!,
          putRaw: result.raw,
        });
      } else {
        // Каса/ФОП + завдаток: спочатку касові new_transactions, потім sale/payment deposit
        const result = await closeVisitInAltegio({
          visitId,
          recordId: appointment.altegioRecordId!,
          attendance: 1,
          comment: input.comment ?? appointment.comment ?? "",
          services: servicePayload,
          payments: accountParts.map((p) => ({ accountId: p.accountId, amount: p.amount })),
        });
        transactionIds = [...result.transactionIds];
        documentId = await resolveVisitSaleDocumentId({
          visitId,
          recordId: appointment.altegioRecordId!,
          putRaw: result.raw,
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
    }

    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: {
        attendance: 1,
        ...(visitId > 0 ? { altegioVisitId: visitId } : {}),
      },
    });

    let depositAccountId: string | null = null;
    if (hasDeposit && depositMeta && !skipAltegioWrite) {
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
          `[journal/checkout] Ledger spend не записано (оплата в Altegio вже є):`,
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
    });

    await prisma.salonCheckout.update({
      where: { id: pendingId },
      data: {
        status: "synced",
        syncError: skipAltegioWrite
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
