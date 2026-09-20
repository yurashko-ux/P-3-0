/**
 * Тимчасовий режим тесту каси журналу: не писати створення записів і оплати в Altegio.
 * Увімкнено за замовчуванням. Щоб знову писати в Altegio: JOURNAL_SKIP_ALTEGIO_WRITE=0
 */
export function isJournalAltegioWriteSkipped(): boolean {
  const v = String(process.env.JOURNAL_SKIP_ALTEGIO_WRITE ?? "1")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}
