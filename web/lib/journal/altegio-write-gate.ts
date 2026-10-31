/**
 * Dual-write Журнал (Kresco) → Altegio.
 *
 * JOURNAL_SKIP_ALTEGIO_WRITE (за замовчуванням «1»):
 *   1 — не писати в Altegio касу, завдатки, hair тощо.
 *   0 — повний dual-write усього.
 *
 * JOURNAL_ALTEGIO_WRITE_CONSULTATIONS (за замовчуванням «1»):
 *   навіть при глобальному skip — створення/оновлення/скасування консультацій
 *   з Kresco йдуть у Altegio API. Імпорт з Altegio не вимикається.
 *   0 — і консультації лише в Kresco.
 */

function envFlag(name: string, defaultValue: string): string {
  return String(process.env[name] ?? defaultValue)
    .trim()
    .toLowerCase();
}

function isEnabledFlag(raw: string): boolean {
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function isDisabledFlag(raw: string): boolean {
  return raw === "0" || raw === "false" || raw === "off" || raw === "no";
}

/** Глобальний skip (каса / hair / …). За замовчуванням увімкнено. */
export function isJournalAltegioWriteSkipped(): boolean {
  const v = envFlag("JOURNAL_SKIP_ALTEGIO_WRITE", "1");
  if (isDisabledFlag(v)) return false;
  return true;
}

/** Чи дозволено dual-write саме консультацій. За замовчуванням так. */
export function isJournalAltegioConsultationWriteEnabled(): boolean {
  const v = envFlag("JOURNAL_ALTEGIO_WRITE_CONSULTATIONS", "1");
  if (isDisabledFlag(v)) return false;
  return isEnabledFlag(v) || v === "";
}

/**
 * Чи писати цей запис журналу в Altegio (create / update / cancel / attendance).
 * Імпорт Altegio → Kresco завжди працює окремо.
 */
export function shouldWriteJournalAppointmentToAltegio(opts: {
  isConsultation: boolean;
}): boolean {
  if (!isJournalAltegioWriteSkipped()) return true;
  if (opts.isConsultation && isJournalAltegioConsultationWriteEnabled()) return true;
  return false;
}

export function isConsultationServiceKind(kind: string | null | undefined): boolean {
  return String(kind || "").trim().toLowerCase() === "consultation";
}
