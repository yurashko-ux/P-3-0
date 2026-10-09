// Реєстр оплат візитів (SalonCheckoutPayment).

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import { bankLinksForVisitPayments } from "@/lib/finance/visit-payment-bank";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ListVisitPaymentsParams = {
  from?: string | null;
  to?: string | null;
  accountId?: number | null;
  paymentKind?: "account" | "deposit" | "all" | null;
  q?: string | null;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  limit?: number;
};

export async function listVisitPayments(params: ListVisitPaymentsParams = {}) {
  const take = Math.min(Math.max(Number(params.limit) || 100, 1), 500);
  const from = String(params.from || "").trim();
  const to = String(params.to || "").trim();
  const accountId = Number(params.accountId) || 0;
  const kind = params.paymentKind === "account" || params.paymentKind === "deposit" ? params.paymentKind : null;
  const q = String(params.q || "").trim();
  const sort = params.sort || "date_desc";

  const orderBy =
    sort === "date_asc"
      ? [{ checkout: { kyivDay: "asc" as const } }, { checkout: { createdAt: "asc" as const } }]
      : sort === "amount_desc"
        ? [{ amount: "desc" as const }, { checkout: { kyivDay: "desc" as const } }]
        : sort === "amount_asc"
          ? [{ amount: "asc" as const }, { checkout: { kyivDay: "desc" as const } }]
          : [{ checkout: { kyivDay: "desc" as const } }, { checkout: { createdAt: "desc" as const } }];

  const rows = await prisma.salonCheckoutPayment.findMany({
    where: {
      ...(accountId > 0 ? { accountId } : {}),
      ...(kind ? { paymentKind: kind } : {}),
      checkout: {
        ...(from || to
          ? {
              kyivDay: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              appointment: {
                OR: [
                  { clientName: { contains: q, mode: "insensitive" } },
                  { staffName: { contains: q, mode: "insensitive" } },
                  {
                    directClient: {
                      OR: [
                        { firstName: { contains: q, mode: "insensitive" } },
                        { lastName: { contains: q, mode: "insensitive" } },
                        { instagramUsername: { contains: q, mode: "insensitive" } },
                      ],
                    },
                  },
                ],
              },
            }
          : {}),
      },
    },
    include: {
      checkout: {
        select: {
          id: true,
          kyivDay: true,
          status: true,
          paidAmount: true,
          altegioRecordId: true,
          createdAt: true,
          appointment: {
            select: {
              id: true,
              clientName: true,
              staffName: true,
              altegioRecordId: true,
              kyivDay: true,
              directClient: {
                select: { firstName: true, lastName: true, instagramUsername: true },
              },
              master: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy,
    take,
  });

  const mapped = rows.map((row) => {
    const appt = row.checkout.appointment;
    const client =
      appt?.clientName ||
      [appt?.directClient?.lastName, appt?.directClient?.firstName].filter(Boolean).join(" ") ||
      appt?.directClient?.instagramUsername ||
      "—";
    const master = appt?.staffName || appt?.master?.name || "—";
    return {
      id: row.id,
      checkoutId: row.checkoutId,
      appointmentId: appt?.id || null,
      kyivDay: row.checkout.kyivDay,
      occurredAt: row.checkout.createdAt.toISOString(),
      client,
      master,
      accountId: row.accountId,
      accountTitle: row.accountTitle,
      amount: toMoney(row.amount),
      amountFx: row.amountFx != null && row.amountFx > 0 ? toMoney(row.amountFx) : null,
      currencyCode: row.currencyCode ? String(row.currencyCode).trim().toUpperCase() : null,
      fxRate: row.fxRate != null && row.fxRate > 0 ? row.fxRate : null,
      paymentKind: row.paymentKind,
      checkoutStatus: row.checkout.status,
      altegioRecordId: row.checkout.altegioRecordId || appt?.altegioRecordId || null,
      altegioTransactionId: row.altegioTransactionId,
      paidAmount: toMoney(row.checkout.paidAmount),
    };
  });

  const links = await bankLinksForVisitPayments(mapped);
  return mapped.map((row) => {
    const bank = links.get(row.id) || null;
    return { ...row, reconciled: bank != null, bank };
  });
}

const RECONCILED_LOCK = "Платіж зведено з банком — змінити або видалити не можна";

async function paymentRef(id: string) {
  const row = await prisma.salonCheckoutPayment.findUnique({
    where: { id },
    include: {
      checkout: {
        select: {
          id: true,
          kyivDay: true,
          appointment: {
            select: {
              clientName: true,
              directClient: { select: { lastName: true, firstName: true } },
            },
          },
        },
      },
    },
  });
  if (!row) throw new Error("Платіж не знайдено");
  const appt = row.checkout.appointment;
  const client =
    appt?.clientName ||
    [appt?.directClient?.lastName, appt?.directClient?.firstName].filter(Boolean).join(" ") ||
    "—";
  return { row, client };
}

async function assertPaymentEditable(id: string) {
  const { row, client } = await paymentRef(id);
  const links = await bankLinksForVisitPayments([
    {
      id: row.id,
      altegioTransactionId: row.altegioTransactionId,
      accountId: row.accountId,
      accountTitle: row.accountTitle,
      amount: row.amount,
      kyivDay: row.checkout.kyivDay,
      client,
      paymentKind: row.paymentKind,
    },
  ]);
  if (links.has(row.id)) throw new Error(RECONCILED_LOCK);
  return row;
}

async function refreshCheckoutPaidAmount(checkoutId: string) {
  const payments = await prisma.salonCheckoutPayment.findMany({
    where: { checkoutId },
    select: { amount: true },
  });
  const paidAmount = toMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  await prisma.salonCheckout.update({
    where: { id: checkoutId },
    data: { paidAmount },
  });
}

export async function updateVisitPayment(input: {
  id: string;
  accountId: number;
  amountUah: number;
  amountFx?: number | null;
}) {
  const row = await assertPaymentEditable(input.id);
  const accountId = Number(input.accountId) || 0;
  const amountUah = toMoney(Number(input.amountUah) || 0);
  if (!(accountId > 0)) throw new Error("Оберіть рахунок");
  if (!(amountUah > 0)) throw new Error("Сума має бути більше 0");
  const accounts = await listVisitPaymentFilterAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("Рахунок не знайдено");

  const fxAccount = isUsdCashAccountTitle(account.title) || isEurCashAccountTitle(account.title);
  const amountFx = toMoney(Number(input.amountFx) || 0);
  if (fxAccount && !(amountFx > 0)) throw new Error("Вкажіть суму у валюті");

  await prisma.salonCheckoutPayment.update({
    where: { id: row.id },
    data: {
      accountId,
      accountTitle: account.title,
      amount: amountUah,
      amountFx: fxAccount ? amountFx : null,
      currencyCode: fxAccount ? (isUsdCashAccountTitle(account.title) ? "USD" : "EUR") : null,
      fxRate: fxAccount && amountFx > 0 ? toMoney(amountUah / amountFx) : null,
    },
  });
  await refreshCheckoutPaidAmount(row.checkoutId);
  console.log(`[finance/visit-payments] Оновлено платіж ${row.id}: рахунок ${accountId}, ${amountUah} грн`);
}

export async function deleteVisitPayment(id: string) {
  const row = await assertPaymentEditable(id);
  await prisma.salonCheckoutPayment.delete({ where: { id: row.id } });
  await refreshCheckoutPaidAmount(row.checkoutId);
  console.log(`[finance/visit-payments] Видалено платіж ${row.id} з чека ${row.checkoutId}`);
}

export async function listVisitPaymentFilterAccounts() {
  const [fromDb, fromAltegio] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      distinct: ["accountId"],
      select: { accountId: true, accountTitle: true },
      take: 200,
    }),
    fetchAltegioAccounts().catch(() => []),
  ]);
  const map = new Map<number, string>();
  for (const a of fromAltegio) {
    const id = Number(a.id) || 0;
    if (id > 0) map.set(id, a.title);
  }
  for (const row of fromDb) {
    if (row.accountId > 0 && !map.has(row.accountId)) {
      map.set(row.accountId, row.accountTitle || `Рахунок #${row.accountId}`);
    }
  }
  return Array.from(map.entries())
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "uk"));
}
