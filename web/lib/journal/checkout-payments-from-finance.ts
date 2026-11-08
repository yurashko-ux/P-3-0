// Оплати імпортованих з Altegio чеків — по справжніх рахунках.
// Раніше чек з Altegio мав одну технічну оплату «Altegio» (рахунок 0), тож не було видно,
// скільки пройшло через термінал ФОП, а скільки готівкою. Тепер, починаючи з
// JOURNAL_REAL_PAYMENTS_FROM_DAY, після синхронізації фінансових операцій Altegio оплати чека
// замінюються рядками за рахунками з тих операцій (record_id). Старі дні не чіпаємо.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** З цього дня (Europe/Kyiv) оплати імпортованих чеків пишемо по рахунках. */
export const JOURNAL_REAL_PAYMENTS_FROM_DAY = "2026-11-08";

type FinanceRow = {
  altegioId: number;
  accountId: string | null;
  accountTitle: string | null;
  amountKopiykas: bigint;
  recordIdText: string | null;
};

/**
 * Запити: 1 до операцій + 1 до чеків + по 2 (delete + createMany) на кожен змінений чек.
 * Чеки, створені в Креско (source=kresco), не чіпаємо.
 */
export async function syncCheckoutPaymentsFromFinance(fromKyivDay: string = JOURNAL_REAL_PAYMENTS_FROM_DAY) {
  const day = fromKyivDay < JOURNAL_REAL_PAYMENTS_FROM_DAY ? JOURNAL_REAL_PAYMENTS_FROM_DAY : fromKyivDay;
  const rows = await prisma.$queryRaw<FinanceRow[]>(Prisma.sql`
    SELECT "altegioId", "accountId", "accountTitle", "amountKopiykas",
           NULLIF("rawData"->>'record_id', '') AS "recordIdText"
    FROM "altegio_finance_transactions"
    WHERE "deletedInAltegio" = false
      AND "kyivDay" >= ${day}
      AND "amountKopiykas" > 0
      AND "direction" <> 'transfer'
      AND NULLIF("rawData"->>'record_id', '') IS NOT NULL
  `);
  const byRecord = new Map<number, FinanceRow[]>();
  for (const row of rows) {
    const recordId = Number(row.recordIdText) || 0;
    const accountId = Number(row.accountId) || 0;
    if (!(recordId > 0) || !(accountId > 0)) continue;
    byRecord.set(recordId, [...(byRecord.get(recordId) || []), row]);
  }
  if (byRecord.size === 0) return { records: 0, updated: 0 };

  const checkouts = await prisma.salonCheckout.findMany({
    where: { altegioRecordId: { in: [...byRecord.keys()] }, source: "altegio", kyivDay: { gte: day } },
    select: { id: true, altegioRecordId: true, payments: { select: { altegioTransactionId: true } } },
  });

  let updated = 0;
  for (const checkout of checkouts) {
    const finance = byRecord.get(Number(checkout.altegioRecordId)) || [];
    if (finance.length === 0) continue;
    const wanted = new Set(finance.map((row) => row.altegioId));
    const current = new Set(checkout.payments.map((payment) => payment.altegioTransactionId).filter(Boolean));
    const same = wanted.size === current.size && [...wanted].every((id) => current.has(id));
    if (same) continue;
    await prisma.$transaction([
      prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: checkout.id } }),
      prisma.salonCheckoutPayment.createMany({
        data: finance.map((row) => ({
          checkoutId: checkout.id,
          accountId: Number(row.accountId),
          accountTitle: row.accountTitle,
          amount: Number(row.amountKopiykas) / 100,
          altegioTransactionId: row.altegioId,
        })),
      }),
    ]);
    updated += 1;
  }
  if (updated > 0) {
    console.log(`[journal/checkout-payments] Оплати по рахунках з ${day}: оновлено чеків ${updated} з ${checkouts.length}`);
  }
  return { records: byRecord.size, updated };
}
