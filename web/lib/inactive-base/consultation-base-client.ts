// Критерії бази «Консультації» в розділі неактивної бази.

import { toKyivDay } from '@/lib/direct-stats-config';
import { hasPaidServiceVisitForInactiveBase } from '@/lib/inactive-base/is-inactive-client';

export type InactiveBaseView = 'inactive' | 'consultation_attended' | 'consultation_not_attended';

export type ConsultationSalonVisit = 'attended' | 'not_attended';

const VALID_BASE_VIEWS: InactiveBaseView[] = [
  'inactive',
  'consultation_attended',
  'consultation_not_attended',
];

export function parseInactiveBaseView(raw: string | null | undefined): InactiveBaseView {
  const v = (raw || '').trim();
  if (VALID_BASE_VIEWS.includes(v as InactiveBaseView)) return v as InactiveBaseView;
  return 'inactive';
}

export type ConsultationBaseClientFields = {
  consultationBookingDate?: Date | string | null;
  consultationDate?: Date | string | null;
  consultationAttended?: boolean | null;
  consultationAttendanceValue?: number | null;
  consultationCancelled?: boolean | null;
  consultationDeletedInAltegio?: boolean | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: number | null;
  paidRecordsInHistoryCount?: number | null;
  spent?: number | null;
};

/** Є запис / слід консультації (як Direct days=consultation). */
export function hasConsultationRecordForBase(c: ConsultationBaseClientFields): boolean {
  return Boolean(
    c.consultationBookingDate ||
      c.consultationDate ||
      c.consultationAttended != null ||
      c.consultationAttendanceValue != null ||
      c.consultationCancelled === true
  );
}

/** Спільний пул консультаційної бази: консультація є, платних візитів ніколи не було. */
export function isConsultationBasePoolClient(c: ConsultationBaseClientFields): boolean {
  if (c.consultationDeletedInAltegio === true) return false;
  if (hasPaidServiceVisitForInactiveBase(c)) return false;
  return hasConsultationRecordForBase(c);
}

/** Консультація відбулась — останній активний статус attended, дата ≤ сьогодні (Kyiv). */
export function isConsultationAttendedClient(
  c: ConsultationBaseClientFields,
  todayKyiv: string
): boolean {
  if (!isConsultationBasePoolClient(c)) return false;
  if (c.consultationAttended !== true) return false;
  const bookingRaw = c.consultationBookingDate ?? c.consultationDate ?? null;
  const bookingIso =
    bookingRaw == null
      ? null
      : typeof bookingRaw === "string"
        ? bookingRaw
        : bookingRaw.toISOString();
  const consultDay = toKyivDay(bookingIso);
  return consultDay != null && consultDay <= todayKyiv;
}

/** Консультація не відбулась — останній активний статус не attended (no-show, скасовано, очікується). */
export function isConsultationNotAttendedClient(c: ConsultationBaseClientFields): boolean {
  if (!isConsultationBasePoolClient(c)) return false;
  return c.consultationAttended !== true;
}

/** Для майбутнього фільтра «були / не були у нас» (лише консультація, без платних візитів). */
export function getConsultationSalonVisit(
  c: ConsultationBaseClientFields,
  todayKyiv: string
): ConsultationSalonVisit {
  return isConsultationAttendedClient(c, todayKyiv) ? 'attended' : 'not_attended';
}

export function filterClientsByInactiveBaseView<T extends ConsultationBaseClientFields>(
  clients: T[],
  view: InactiveBaseView,
  todayKyiv: string
): T[] {
  if (view === 'consultation_attended') {
    return clients.filter((c) => isConsultationAttendedClient(c, todayKyiv));
  }
  if (view === 'consultation_not_attended') {
    return clients.filter((c) => isConsultationNotAttendedClient(c));
  }
  return clients;
}
