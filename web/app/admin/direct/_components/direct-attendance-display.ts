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
  // Майбутній візит (за календарним днём Kyiv): без явного коду в БД майже завжди «підтвердив» (2).
  if (visitKyivDay > todayKyivDay) return 2;
  return 1;
}
