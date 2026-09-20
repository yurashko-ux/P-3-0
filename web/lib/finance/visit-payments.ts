// Реєстр оплат візитів (SalonCheckoutPayment).

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";

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

  return rows.map((row) => {
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
      paymentKind: row.paymentKind,
      checkoutStatus: row.checkout.status,
      altegioRecordId: row.checkout.altegioRecordId || appt?.altegioRecordId || null,
      altegioTransactionId: row.altegioTransactionId,
      paidAmount: toMoney(row.checkout.paidAmount),
    };
  });
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
