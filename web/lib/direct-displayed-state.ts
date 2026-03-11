// web/lib/direct-displayed-state.ts
// Утиліта для обчислення відображуваного стану клієнта в колонці «Стан»

import type { DirectClient } from '@/lib/direct-types';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

function parseMaybeIsoDate(raw: unknown): Date | null {
  if (!raw) return null;
  const dateValue = typeof raw === 'string' ? raw.trim() : String(raw);
  const isoDateMatch = dateValue.match(
    /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/
  );
  const d = new Date(isoDateMatch ? isoDateMatch[0] : dateValue);
  return isNaN(d.getTime()) ? null : d;
}

export type DisplayedStateId =
  | 'paid-past'
  | 'sold'
  | 'rebook'
  | 'waiting'
  | 'broken-heart'
  | 'consultation-past'
  | 'consultation-booked'
  | 'new-lead'
  | 'message'
  | 'binotel-lead';

/**
 * Повертає ID стану, який відображається в колонці «Стан».
 * Логіка узгоджена з DirectClientTable (порядок перевірок).
 * Тільки похідні стани, без fallback на client.state.
 */
export function getDisplayedState(client: DirectClient): DisplayedStateId | null {
  if (client.state === 'binotel-lead') return 'binotel-lead';

  const todayKyivDay = kyivDayFromISO(new Date().toISOString());

  const consultDate = parseMaybeIsoDate(client.consultationBookingDate);
  const consultKyivDay = consultDate ? kyivDayFromISO(consultDate.toISOString()) : null;

  const paidDate = client.paidServiceDate ? new Date(client.paidServiceDate) : null;
  const paidKyivDay =
    paidDate && !isNaN(paidDate.getTime()) ? kyivDayFromISO(paidDate.toISOString()) : null;

  const hasPaidReschedule = Boolean((client as { paidServiceIsRebooking?: boolean }).paidServiceIsRebooking);

  const isPaidPast = Boolean(paidKyivDay && paidKyivDay < todayKyivDay);
  const isConsultPast = Boolean(consultKyivDay && consultKyivDay < todayKyivDay);
  // Перший платний запис: в історії платних записів (records:log) немає жодного запису — вогник з'являється в момент створення
  const paidRecordsInHistory = client.paidRecordsInHistoryCount;
  const isFirstPaidRecord = paidRecordsInHistory !== undefined && paidRecordsInHistory === 0;
  const isPaidFutureOrToday = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);
  const isPaidToday = Boolean(paidKyivDay && paidKyivDay === todayKyivDay);

  // 1. 🔥 Вогник — єдина умова: перший платний запис (paidRecordsInHistoryCount === 0)
  if (client.paidServiceDate && isFirstPaidRecord) return 'sold';

  // 2. Червона дата (букінгдата < сьогодні) → paid-past
  if (client.paidServiceDate && isPaidPast) return 'paid-past';

  // 3. 🔁 Перезапис (сьогодні)
  if (
    client.paidServiceDate &&
    isPaidToday &&
    hasPaidReschedule &&
    !client.paidServiceCancelled &&
    client.paidServiceAttended !== false
  ) {
    return 'rebook';
  }

  // 4. 🔁 Перезапис (майбутнє)
  if (
    client.paidServiceDate &&
    isPaidFutureOrToday &&
    hasPaidReschedule &&
    !client.paidServiceCancelled &&
    client.paidServiceAttended !== false
  ) {
    return 'rebook';
  }

  // 5. ⏳ Очікування
  if (client.paidServiceDate && isPaidFutureOrToday) return 'waiting';

  // 6. 💔 Не продали
  if (
    client.consultationAttended === true &&
    isConsultPast &&
    (!client.paidServiceDate || !client.signedUpForPaidService)
  ) {
    return 'broken-heart';
  }

  // 7. Рожевий календар — консультація з минулою датою
  if (
    client.consultationBookingDate &&
    isConsultPast &&
    (!client.paidServiceDate || !client.signedUpForPaidService)
  ) {
    return 'consultation-past';
  }

  // 8. Синій календар — запис на консультацію
  if (client.consultationBookingDate) return 'consultation-booked';

  // 9. Лід без консультації/запису
  if (!client.altegioClientId && !client.paidServiceDate && !client.consultationBookingDate) {
    const firstDate = client.firstContactDate || client.createdAt;
    const firstDateObj = firstDate ? new Date(firstDate) : null;
    if (firstDateObj && !isNaN(firstDateObj.getTime())) {
      const todayKyivStr = kyivDayFromISO(new Date().toISOString());
      const firstKyivStr = kyivDayFromISO(firstDateObj.toISOString());
      const todayStart = new Date(todayKyivStr + 'T00:00:00.000Z').getTime();
      const firstStart = new Date(firstKyivStr + 'T00:00:00.000Z').getTime();
      const daysSinceFirst = Math.floor((todayStart - firstStart) / 86400000);
      if (daysSinceFirst === 0) return 'new-lead';
      return 'message';
    }
  }

  return null;
}
