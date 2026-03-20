// web/lib/direct-f4-client-match.ts
// Умови F4 «новий запис на платну» — ті самі, що в Prisma (record-created-counts / статистика).

import type { DirectClient } from '@/lib/direct-types';
import { getKyivDayUtcBounds, getTodayKyiv } from '@/lib/direct-stats-config';

/** Перший день місяця YYYY-MM-01 для дати YYYY-MM-DD (Kyiv). */
export function startOfMonthKyivFromDay(kyivDay: string): string {
  const m = kyivDay.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return kyivDay;
  return `${m[1]}-${m[2]}-01`;
}

/** Останній календарний день місяця (YYYY-MM-DD, Kyiv) для дати в цьому ж місяці. */
export function endOfMonthKyivFromDay(kyivDay: string): string {
  const m = kyivDay.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return kyivDay;
  const y = Number(m[1]);
  const month1to12 = Number(m[2]);
  const lastDay = new Date(y, month1to12, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${m[1]}-${m[2]}-${pad(lastDay)}`;
}

/**
 * Чи клієнт входить у підрахунок F4 за інтервалом [startUtc, endExclusiveUtc) по paidServiceRecordCreatedAt.
 * Дзеркало Prisma: cost > 0, history = 0, не перезапис.
 */
export function clientMatchesF4NewPaidInUtcInterval(
  client: DirectClient,
  startUtc: Date,
  endExclusiveUtc: Date
): boolean {
  const cost = client.paidServiceTotalCost ?? 0;
  if (cost <= 0) return false;
  if (client.paidRecordsInHistoryCount !== 0) return false;
  if (client.paidServiceIsRebooking === true) return false;

  const createdRaw = client.paidServiceRecordCreatedAt;
  if (!createdRaw) return false;
  const created = new Date(createdRaw);
  if (isNaN(created.getTime())) return false;
  return created.getTime() >= startUtc.getTime() && created.getTime() < endExclusiveUtc.getTime();
}

/** F4 за повний календарний місяць Kyiv, в якому лежить anchorKyivDay. */
export function clientMatchesF4NewPaidInKyivCalendarMonth(
  client: DirectClient,
  anchorKyivDay: string
): boolean {
  const startKyiv = startOfMonthKyivFromDay(anchorKyivDay);
  const endKyiv = endOfMonthKyivFromDay(anchorKyivDay);
  const { startUtc } = getKyivDayUtcBounds(startKyiv);
  const { endUtc: monthEndExclusiveUtc } = getKyivDayUtcBounds(endKyiv);
  return clientMatchesF4NewPaidInUtcInterval(client, startUtc, monthEndExclusiveUtc);
}

/**
 * Чи показувати 🔥 «Продано» зараз (поточний календарний місяць Kyiv = місяць «сьогодні» або ?day=).
 */
export function clientShowsF4SoldFireNow(
  client: DirectClient,
  dayParam?: string | null
): boolean {
  const todayKyiv = getTodayKyiv(dayParam);
  return clientMatchesF4NewPaidInKyivCalendarMonth(client, todayKyiv);
}
