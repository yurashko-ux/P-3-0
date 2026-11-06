const ALTEGIO_WEB_COMPANY_ID =
  process.env.NEXT_PUBLIC_ALTEGIO_COMPANY_ID?.trim() || "1169323";

/** Редагування фінансової операції в веб-адмінці Altegio. */
export function buildAltegioTransactionEditUrl(altegioTransactionId: number): string {
  return `https://app.alteg.io/finances/transactions/edit/${ALTEGIO_WEB_COMPANY_ID}/${altegioTransactionId}`;
}

/** Відкрити запис у журналі (timetable) Altegio. */
export function buildAltegioRecordTimetableUrl(
  recordId: number,
  kyivDay?: string | null,
): string {
  const base = `https://app.alteg.io/timetable/${ALTEGIO_WEB_COMPANY_ID}`;
  const day = kyivDay?.trim();
  return day
    ? `${base}#mode=1&main_date=${day}&open_record_id=${recordId}`
    : `${base}#open_record_id=${recordId}`;
}
