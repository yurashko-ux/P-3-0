// Каса: закриття візиту (послуги + товари + один рахунок оплати), dual-write з Altegio.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { fetchTimetableTransactionsForRecord } from "@/lib/altegio/record-payments";
import {
  closeVisitInAltegio,
  resolveAltegioVisitId,
} from "@/lib/altegio/visit-checkout-write";
import { closeVisitPaidFromDeposit } from "@/lib/altegio/visit-deposit-pay";
import { fetchDepositsForClientIds } from "@/lib/altegio/client-deposits";
import { appendDepositSpend } from "@/lib/deposits/store";
import { searchWarehouseProducts } from "@/lib/warehouse/catalog";
import { createWriteOff } from "@/lib/warehouse/documents-kresco";
import { resolveJournalCompanyId } from "./company-id";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isDepositAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
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

export type CloseVisitInput = {
  appointmentId: string;
  services: CheckoutServiceLineInput[];
  goods?: CheckoutGoodLineInput[];
  /** Звичайний рахунок каси/ФОП; для завдатку можна 0 */
  accountId: number;
  accountTitle?: string;
  /** Оплата з особистого рахунку клієнта (Altegio deposit_id) */
  depositId?: number | null;
  comment?: string;
  createdBy?: string | null;
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
      checkout: { include: checkoutInclude },
      directClient: {
        select: { id: true, firstName: true, lastName: true, instagramUsername: true, phone: true },
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
  const goodsSum = toMoney(
    (appointment.checkout?.goodLines || []).reduce(
      (s, g) => s + (Number(g.salePrice) || 0) * (Number(g.quantity) || 0),
      0,
    ),
  );
  const expectedTotal =
    appointment.checkout?.paidAmount != null && appointment.checkout.paidAmount > 0
      ? toMoney(appointment.checkout.paidAmount)
      : toMoney(servicesSum + goodsSum);

  return {
    appointment,
    accounts,
    storages,
    catalogProducts,
    clientDeposits,
    altegioPaid,
    altegioPayments,
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
  if (!(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
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
    .filter((s) => s.altegioServiceId > 0 && s.cost >= 0);

  if (services.length === 0) throw new Error("Додайте хоча б одну послугу");

  const goods = await normalizeGoods(input.goods);
  const totalServices = toMoney(services.reduce((s, l) => s + l.cost, 0));
  const totalGoods = toMoney(goods.reduce((s, g) => s + g.lineTotal, 0));
  const paidAmount = toMoney(totalServices + totalGoods);
  if (!(paidAmount > 0)) throw new Error("Сума чека має бути більше 0");

  const depositId = Number(input.depositId) || 0;
  const payFromDeposit = depositId > 0;

  let accountId = Number(input.accountId) || 0;
  let accountTitle = input.accountTitle || "";

  if (payFromDeposit) {
    const altegioClientId = Number(appointment.altegioClientId) || 0;
    if (!(altegioClientId > 0)) {
      throw new Error("Немає id клієнта Altegio — неможливо списати завдаток");
    }
    const dep = await fetchDepositsForClientIds({ clientIds: [altegioClientId] });
    const deposit = (dep.deposits || []).find((d) => d.depositId === depositId);
    if (!deposit) throw new Error("Завдаток клієнта не знайдено в Altegio");
    if (deposit.blocked) throw new Error("Особистий рахунок клієнта заблоковано");
    const balance = toMoney(deposit.balance);
    if (balance + 0.009 < paidAmount) {
      throw new Error(
        `Недостатньо на завдаткові: ${balance.toLocaleString("uk-UA")} грн, потрібно ${paidAmount.toLocaleString("uk-UA")} грн`,
      );
    }
    accountId = depositId; // у платежі чека зберігаємо deposit_id для аудиту
    accountTitle = `Завдаток: ${deposit.depositTypeTitle || "особистий рахунок"}`;
  } else {
    if (!(accountId > 0)) throw new Error("Оберіть рахунок оплати");
    const accounts = await fetchAltegioAccounts();
    const account = accounts.find((a) => Number(a.id) === accountId);
    if (!account) throw new Error("Рахунок Altegio не знайдено");
    if (isDepositAccountTitle(account.title)) {
      throw new Error("Оберіть завдаток клієнта зі списку «З завдатку», а не касовий рахунок");
    }
    accountTitle = input.accountTitle || account.title;
  }

  const clientLabel =
    [appointment.directClient?.lastName, appointment.directClient?.firstName].filter(Boolean).join(" ") ||
    appointment.clientName ||
    appointment.directClient?.instagramUsername ||
    "клієнт";

  // Ідемпотентність: уже оплачено на повну суму в Altegio або в Kresco.
  const companyId = resolveJournalCompanyId();
  const existingTxs = await fetchTimetableTransactionsForRecord(companyId, appointment.altegioRecordId);
  const altegioPaid = toMoney(
    existingTxs.filter((t) => !t.deleted && t.amount > 0).reduce((s, t) => s + t.amount, 0),
  );

  const alreadyFullyPaid =
    (appointment.checkout?.status === "synced" &&
      appointment.checkout.paidAmount + 0.009 >= paidAmount) ||
    altegioPaid + 0.009 >= paidAmount;

  if (alreadyFullyPaid) {
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
  if (!(visitId > 0)) {
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
        payments: {
          create: [
            {
              accountId,
              accountTitle,
              amount: paidAmount,
              paymentKind: payFromDeposit ? "deposit" : "account",
            },
          ],
        },
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
    await prisma.salonCheckoutPayment.create({
      data: {
        checkoutId: pendingId,
        accountId,
        accountTitle,
        amount: paidAmount,
        paymentKind: payFromDeposit ? "deposit" : "account",
      },
    });
  }

  await replaceCheckoutGoodLines(pendingId, goods);

  try {
    const servicePayload = services.map((s) => ({
      id: s.altegioServiceId,
      amount: s.amount,
      firstCost: s.cost,
      cost: s.cost,
      discount: 0,
      title: s.title,
      recordId: appointment.altegioRecordId!,
    }));

    const result = payFromDeposit
      ? await closeVisitPaidFromDeposit({
          visitId,
          recordId: appointment.altegioRecordId,
          attendance: 1,
          comment: input.comment ?? appointment.comment ?? "",
          services: servicePayload,
          depositId,
          amount: paidAmount,
        })
      : await closeVisitInAltegio({
          visitId,
          recordId: appointment.altegioRecordId,
          attendance: 1,
          comment: input.comment ?? appointment.comment ?? "",
          services: servicePayload,
          payments: [{ accountId, amount: paidAmount }],
        });

    const txId = result.transactionIds[0] || null;
    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: { attendance: 1, altegioVisitId: visitId },
    });

    let depositAccountId: string | null = null;
    if (payFromDeposit) {
      try {
        const spend = await appendDepositSpend({
          altegioClientId: Number(appointment.altegioClientId) || 0,
          altegioDepositId: depositId,
          amount: paidAmount,
          appointmentId: appointment.id,
          checkoutId: pendingId,
          directClientId: appointment.directClientId,
          altegioDocumentId: "documentId" in result ? Number((result as any).documentId) || null : null,
          altegioPaymentTxId: txId,
          kyivDay: appointment.kyivDay,
          comment: `Оплата візиту з завдатку`,
          title: accountTitle.replace(/^Завдаток:\s*/i, "") || null,
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
        syncError: stock.stockError,
        paidAmount,
        totalServices,
        totalGoods,
        altegioVisitId: visitId,
        ...(stock.warehouseDocumentId ? { warehouseDocumentId: stock.warehouseDocumentId } : {}),
      },
    });

    const saved = await prisma.salonCheckout.findUnique({
      where: { id: pendingId },
      include: checkoutInclude,
    });
    if (txId && saved?.payments[0]) {
      await prisma.salonCheckoutPayment.update({
        where: { id: saved.payments[0].id },
        data: {
          altegioTransactionId: txId,
          paymentKind: payFromDeposit ? "deposit" : "account",
          ...(depositAccountId ? { depositAccountId } : {}),
        },
      });
    }
    console.log(
      `[journal/checkout] ✅ Закрито appointment=${appointment.id} → Altegio visit=${visitId} paid=${paidAmount} goods=${totalGoods}${payFromDeposit ? ` deposit=${depositId}` : ""}`,
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
