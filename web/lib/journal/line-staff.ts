// Парсинг/серіалізація виконавців на рядку послуги або товару.

export function parseStaffIdsJson(raw: string | null | undefined): number[] {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => Number(x))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

export function serializeStaffIds(ids: number[]): string | null {
  const cleaned = [...new Set(ids.map((x) => Number(x)).filter((id) => Number.isFinite(id) && id > 0))];
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

/** Підсумкова сума рядка послуги після знижки. */
export function linePayable(firstCost: number, amount: number, discountPercent: number): number {
  const base = Math.max(0, Number(firstCost) || 0);
  const qty = Math.max(0, Number(amount) || 0);
  const disc = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return Math.round(base * qty * (1 - disc / 100) * 100) / 100;
}
