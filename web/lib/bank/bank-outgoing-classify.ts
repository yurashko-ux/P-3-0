function normalizeBankText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»""'']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Контрагент: АТ «Універсал Банк» (поле counterName у виписці). */
export function isUniversalBankCounterparty(counterName: string | null): boolean {
  if (!counterName?.trim()) return false;
  const normalized = normalizeBankText(counterName);
  return (
    (normalized.includes("універсал") || normalized.includes("universal"))
    && normalized.includes("банк")
  );
}

const RKO_TERMINAL_PURPOSE_PATTERNS = [
  "погашення комісії за рко",
  "погашення комисії за рко",
  "щомісячна комісія за рко",
  "щомісячна комисія за рко",
] as const;

/** Призначення: «Погашення комісії за РКО» або «Щомісячна комісія за РКО». */
export function isRkoTerminalPurpose(description: string, comment: string | null): boolean {
  const purpose = normalizeBankText(`${comment || ""} ${description || ""}`);
  return RKO_TERMINAL_PURPOSE_PATTERNS.some((pattern) => purpose.includes(pattern));
}

/**
 * Вихідний платіж комісії за РКО (термінал): обовʼязково і контрагент Universal Bank,
 * і типове призначення РКО (comment / description).
 */
export function isTerminalRkoBankPayment(params: {
  description: string;
  comment: string | null;
  counterName: string | null;
  amount: bigint;
}): boolean {
  if (params.amount >= 0n) return false;

  return (
    isUniversalBankCounterparty(params.counterName)
    && isRkoTerminalPurpose(params.description, params.comment)
  );
}

/** Місяць з тексту призначення «за 06-2026» → YYYY-MM (якщо знайдено). */
export function parseRkoKyivMonthFromText(text: string): string | null {
  const match = text.match(/за\s+(\d{2})-(\d{4})/i);
  if (!match) return null;
  const month = match[1];
  const year = match[2];
  if (!/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  return `${year}-${month}`;
}
