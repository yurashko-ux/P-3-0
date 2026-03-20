// web/lib/direct-f4-sold-fire-sql.ts
// Підрахунок F4 у БД з тією ж семантикою, що й 🔥 «Новий клієнт» (sold) у direct-displayed-state / DirectClientTable:
// paidServiceDate IS NOT NULL, paidRecordsInHistoryCount = 0 (не NULL),
// paidServiceTotalCost > 0, paidServiceRecordCreatedAt у UTC-діапазоні дня/місяцю (Kyiv),
// і «вогник ще діє» станом на asOfKyivDay: asOf < перше число місяця після місяця створення
// (створення = COALESCE(paidServiceRecordCreatedAt, paidServiceDate) у Europe/Kiev, як isSoldStateExpired).

import type { PrismaClient } from "@prisma/client";

const AS_OF_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type F4SoldFireCountParams = {
  /** Початок періоду (UTC), включно */
  rangeStartUtc: Date;
  /** Кінець періоду (UTC), виключно — як getKyivDayUtcBounds(...).endUtc */
  rangeEndExclusiveUtc: Date;
  /** День звіту YYYY-MM-DD (Kyiv) для перевірки терміну вогника */
  asOfKyivDay: string;
};

/**
 * Кількість direct_clients для комірки F4: умови як у колонці «Стан» для 🔥 sold.
 */
export async function countF4SoldFireClients(
  prisma: PrismaClient,
  params: F4SoldFireCountParams
): Promise<number> {
  const { rangeStartUtc, rangeEndExclusiveUtc, asOfKyivDay } = params;
  if (!AS_OF_DAY_RE.test(asOfKyivDay)) {
    throw new Error("[countF4SoldFireClients] asOfKyivDay має бути YYYY-MM-DD (Kyiv)");
  }

  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM "direct_clients"
    WHERE "paidServiceTotalCost" IS NOT NULL
      AND "paidServiceTotalCost" > 0
      AND "paidServiceDate" IS NOT NULL
      AND "paidRecordsInHistoryCount" = 0
      AND "paidServiceRecordCreatedAt" IS NOT NULL
      AND "paidServiceRecordCreatedAt" >= ${rangeStartUtc}
      AND "paidServiceRecordCreatedAt" < ${rangeEndExclusiveUtc}
      AND ${asOfKyivDay}::date < (
        (date_trunc(
          'month',
          (COALESCE("paidServiceRecordCreatedAt", "paidServiceDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date
        ) + interval '1 month')
      )::date
  `;

  return Number(rows[0]?.count ?? 0);
}
