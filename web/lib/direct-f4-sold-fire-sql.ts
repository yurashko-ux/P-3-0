// web/lib/direct-f4-sold-fire-sql.ts
// Підрахунок F4 у БД — узгоджено з getDisplayedState(client) === 'sold' (🔥):
// - paidServiceDate IS NOT NULL
// - paidRecordsInHistoryCount = 0 (не NULL — як у UI: undefined/null ≠ перший платний)
// - день створення в Europe/Kyiv = (COALESCE(paidServiceRecordCreatedAt, paidServiceDate)) у межах [min, max] включно
// - термін вогника: asOfKyivDay < 1-ше число наступного місяця після місяця цього дня створення
//
// Не вимагаємо paidServiceTotalCost > 0 і не вимагаємо окремо paidServiceRecordCreatedAt — як у колонці «Стан».

import type { PrismaClient } from "@prisma/client";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertYmd(label: string, v: string): void {
  if (!DAY_RE.test(v)) {
    throw new Error(`[countF4SoldFireClients] ${label} має бути YYYY-MM-DD (Kyiv)`);
  }
}

export type F4SoldFireCountParams = {
  /** День звіту YYYY-MM-DD (Kyiv): чи ще «діє» вогник */
  asOfKyivDay: string;
  /** Мінімальний Kyiv-календарний день створення (включно) */
  creationKyivDayMin: string;
  /** Максимальний Kyiv-календарний день створення (включно) */
  creationKyivDayMaxInclusive: string;
};

/**
 * Кількість direct_clients для F4 — та сама семантика, що 🔥 «Продано» / sold у фільтрі «Стан».
 */
export async function countF4SoldFireClients(
  prisma: PrismaClient,
  params: F4SoldFireCountParams
): Promise<number> {
  const { asOfKyivDay, creationKyivDayMin, creationKyivDayMaxInclusive } = params;
  assertYmd("asOfKyivDay", asOfKyivDay);
  assertYmd("creationKyivDayMin", creationKyivDayMin);
  assertYmd("creationKyivDayMaxInclusive", creationKyivDayMaxInclusive);

  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM "direct_clients"
    WHERE "paidServiceDate" IS NOT NULL
      AND "paidRecordsInHistoryCount" = 0
      AND ${asOfKyivDay}::date < (
        (date_trunc(
          'month',
          (COALESCE("paidServiceRecordCreatedAt", "paidServiceDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date
        ) + interval '1 month')
      )::date
      AND (COALESCE("paidServiceRecordCreatedAt", "paidServiceDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date >= ${creationKyivDayMin}::date
      AND (COALESCE("paidServiceRecordCreatedAt", "paidServiceDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date <= ${creationKyivDayMaxInclusive}::date
  `;

  return Number(rows[0]?.count ?? 0);
}
