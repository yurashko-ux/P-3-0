/**
 * Altegio attendance: 1 = прийшов, 2 = підтвердив запис.
 * У direct_clients інколи лишається attended=true без *AttendanceValue (старі вебхуки, sync не оновив 1 vs 2).
 * Історія з API показує правильний код; для таблиці підставляємо евристику лише коли значення відсутнє.
 *
 * @param opts.pastMissingMeansConfirmed — для **платного запису**: якщо коду в БД немає і дата вже минула,
 *   не припускати «прийшов» (1), бо в Altegio часто лишається «підтвердив» (2), поки явно не відмічено прихід.
 *   Для консультації залишаємо стару логіку (минуле без коду → 1), якщо опцію не передати.
 */
export function effectiveAltegioAttendanceDisplay(
  stored: unknown,
  attended: boolean | null | undefined,
  visitKyivDay: string,
  todayKyivDay: string,
  opts?: { pastMissingMeansConfirmed?: boolean }
): 1 | 2 | undefined {
  if (stored === 1 || stored === 2) return stored;
  if (attended !== true) return undefined;
  // Сьогодні або майбутній день (Kyiv YYYY-MM-DD): без коду в БД не показуємо «прийшов» (1) —
  // зранку на день візиту клієнт ще не міг прийти, у Altegio часто лише «підтвердив» (2).
  if (visitKyivDay >= todayKyivDay) return 2;
  // Минулі дні без коду
  if (opts?.pastMissingMeansConfirmed) return 2;
  return 1;
}
