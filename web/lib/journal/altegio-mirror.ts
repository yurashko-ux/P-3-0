// Дубль в Altegio на перехідний період: Kresco зберігає завжди, а якщо дубль не пройшов — лишає позначку.
// Файл без серверних залежностей: ним користуються і сторінки журналу.

/** Початок syncError, коли запис або чек збережено в Kresco, а дубль в Altegio не пройшов. */
export const ALTEGIO_MIRROR_PENDING = "Altegio: не продубльовано — ";
/** Початок syncError запису, скасованого в Kresco, який ще лишився в Altegio. */
export const ALTEGIO_DELETE_PENDING = "Altegio: не видалено — ";

type MirrorRow = { status?: string | null; syncError?: string | null } | null | undefined;

/** Запис або чек чекає на повтор дубля в Altegio. */
export function isAltegioMirrorPending(row: MirrorRow): boolean {
  if (!row) return false;
  const reason = String(row.syncError || "");
  if (row.status === "sync_error") return reason.startsWith(ALTEGIO_MIRROR_PENDING);
  return row.status === "deleted" && reason.startsWith(ALTEGIO_DELETE_PENDING);
}

/** Текст попередження для касира: збережено в Kresco, дубль в Altegio ще не пройшов. */
export function altegioMirrorWarning(row: MirrorRow): string | null {
  return isAltegioMirrorPending(row) ? String(row?.syncError || "") : null;
}

/** Чек оплачено в Kresco: проведений або збережений без дубля в Altegio. */
export function isCheckoutPaidInKresco(checkout: MirrorRow): boolean {
  return checkout?.status === "synced" || isAltegioMirrorPending(checkout);
}
