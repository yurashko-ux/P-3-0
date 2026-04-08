/**
 * Altegio attendance: 1 = прийшов, 2 = підтвердив запис.
 * У direct_clients інколи лишається attended=true без *AttendanceValue (старі вебхуки, cron не робив backfill).
 * Історія з API показує правильний код; для таблиці підставляємо евристику лише коли значення відсутнє.
 */
export function effectiveAltegioAttendanceDisplay(
  stored: unknown,
  attended: boolean | null | undefined,
  visitKyivDay: string,
  todayKyivDay: string
): 1 | 2 | undefined {
  if (stored === 1 || stored === 2) return stored;
  if (attended !== true) return undefined;
  // Сьогодні або майбутній день (Kyiv YYYY-MM-DD): без коду в БД не показуємо «прийшов» (1) —
  // зранку на день візиту клієнт ще не міг прийти, у Altegio часто лише «підтвердив» (2).
  if (visitKyivDay >= todayKyivDay) return 2;
  // Минулі дні: якщо attended=true без коду — найімовірніше факт візиту
  return 1;
}
