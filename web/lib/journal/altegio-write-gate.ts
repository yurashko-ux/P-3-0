/**
 * Тимчасовий режим тесту: записи, створені в Kresco, і все, що з ними пов’язане
 * (зміна, скасування, каса, списання товару з візиту, завдаток), не йдуть в Altegio.
 * З Altegio записи як і раніше заходять. Увімкнено за замовчуванням.
 * Щоб знову писати в Altegio: JOURNAL_SKIP_ALTEGIO_WRITE=0
 */
export function isJournalAltegioWriteSkipped(): boolean {
  const v = String(process.env.JOURNAL_SKIP_ALTEGIO_WRITE ?? "1")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}
