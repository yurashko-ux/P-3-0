/** Купюри гривневої касовки, зверху вниз. */
export const UAH_NOTE_DENOMS = [5, 10, 20, 50, 100, 200, 500, 1000] as const;

export type UahNoteDenom = (typeof UAH_NOTE_DENOMS)[number];

export type CashCountLine = {
  denomination: number;
  qty: number;
};

export function cashCountTotal(lines: CashCountLine[]): number {
  const total = lines.reduce((sum, line) => sum + line.denomination * line.qty, 0);
  return Math.round(total * 100) / 100;
}

export function parseCashCountLines(raw: unknown): CashCountLine[] {
  if (!Array.isArray(raw)) throw new Error("Немає кількостей купюр");
  const byDenom = new Map<number, number>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const denomination = Number((row as { denomination?: unknown }).denomination);
    const qtyRaw = (row as { qty?: unknown }).qty;
    const qty = qtyRaw == null || qtyRaw === "" ? 0 : Number(qtyRaw);
    if (!UAH_NOTE_DENOMS.includes(denomination as UahNoteDenom)) {
      throw new Error("Невідомий номінал купюри");
    }
    if (!Number.isInteger(qty) || qty < 0) throw new Error("Кількість купюр має бути цілим числом від 0");
    byDenom.set(denomination, qty);
  }
  return UAH_NOTE_DENOMS.map((denomination) => ({
    denomination,
    qty: byDenom.get(denomination) || 0,
  }));
}
