/** Купюри касовки, зверху вниз, окремо для кожної валюти. */
export const UAH_NOTE_DENOMS = [5, 10, 20, 50, 100, 200, 500, 1000] as const;
export const USD_NOTE_DENOMS = [1, 2, 5, 10, 20, 50, 100] as const;
export const EUR_NOTE_DENOMS = [5, 10, 20, 50, 100, 200, 500] as const;

export type CashCountCurrency = "UAH" | "USD" | "EUR";

export type CashCountLine = {
  denomination: number;
  qty: number;
};

export function noteDenoms(currency: CashCountCurrency): readonly number[] {
  if (currency === "USD") return USD_NOTE_DENOMS;
  if (currency === "EUR") return EUR_NOTE_DENOMS;
  return UAH_NOTE_DENOMS;
}

export function cashCountUnit(currency: CashCountCurrency): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "грн";
}

export function cashCountTotal(lines: CashCountLine[]): number {
  const total = lines.reduce((sum, line) => sum + line.denomination * line.qty, 0);
  return Math.round(total * 100) / 100;
}

export function parseCashCountLines(raw: unknown, denoms: readonly number[]): CashCountLine[] {
  if (!Array.isArray(raw)) throw new Error("Немає кількостей купюр");
  const allowed = new Set(denoms);
  const byDenom = new Map<number, number>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const denomination = Number((row as { denomination?: unknown }).denomination);
    const qtyRaw = (row as { qty?: unknown }).qty;
    const qty = qtyRaw == null || qtyRaw === "" ? 0 : Number(qtyRaw);
    if (!allowed.has(denomination)) {
      throw new Error("Невідомий номінал купюри");
    }
    if (!Number.isInteger(qty) || qty < 0) throw new Error("Кількість купюр має бути цілим числом від 0");
    byDenom.set(denomination, qty);
  }
  return denoms.map((denomination) => ({
    denomination,
    qty: byDenom.get(denomination) || 0,
  }));
}
