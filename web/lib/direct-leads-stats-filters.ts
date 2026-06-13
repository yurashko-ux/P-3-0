// web/lib/direct-leads-stats-filters.ts
// Клієнт-безпечні фільтри «Ліди» (без KV/Prisma) — для Direct page ("use client").

import { isOnOrAfterDirectStatsMinKyivDay, toKyivDay } from "@/lib/direct-stats-config";

/** Мінімальні поля клієнта для фільтрів «Ліди» у браузері. */
export type LeadsStatsFilterClient = {
  consultationBookingDate?: Date | string | null;
  consultationAttended?: boolean | null;
  consultationDeletedInAltegio?: boolean | null;
  paidServiceRecordCreatedAt?: Date | string | null;
  paidServiceTotalCost?: number | null;
  paidRecordsInHistoryCount?: number | null;
  paidServiceIsRebooking?: boolean | null;
  paidServiceDeletedInAltegio?: boolean | null;
};

function isF4Eligible(client: LeadsStatsFilterClient): boolean {
  return (
    (client.paidServiceTotalCost ?? 0) > 0 &&
    (client.paidRecordsInHistoryCount ?? 0) === 0 &&
    client.paidServiceIsRebooking !== true &&
    client.paidServiceRecordCreatedAt != null
  );
}

/** Консультація факт у «Ліди»: букінг-дата з 2026, клієнт прийшов (attended). */
export function clientHasLeadsConsultFactBooking(client: LeadsStatsFilterClient): boolean {
  if (client.consultationDeletedInAltegio === true) return false;
  if (client.consultationAttended !== true) return false;
  const consultDay = toKyivDay(
    client.consultationBookingDate != null ? String(client.consultationBookingDate) : null
  );
  return Boolean(consultDay && isOnOrAfterDirectStatsMinKyivDay(consultDay));
}

/** F4-запис у «Ліди»: F4, дата створення запису з 2026 (paidServiceRecordCreatedAt, Kyiv). */
export function clientQualifiesForLeadsStatsRecord(client: LeadsStatsFilterClient): boolean {
  if (client.consultationDeletedInAltegio === true || client.paidServiceDeletedInAltegio === true) {
    return false;
  }
  if (!isF4Eligible(client)) return false;
  const f4Day = toKyivDay(
    client.paidServiceRecordCreatedAt != null ? String(client.paidServiceRecordCreatedAt) : null
  );
  return Boolean(f4Day && isOnOrAfterDirectStatsMinKyivDay(f4Day));
}
