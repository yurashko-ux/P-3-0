/** Нормалізує Telegram username: trim, без @, lowercase. Порожній рядок → null. */
export function normalizeTelegramUsername(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  return normalized || null;
}
