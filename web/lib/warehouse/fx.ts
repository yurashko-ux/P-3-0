// Курс USD/UAH з блоку 4 фінзвіту (KV). Без CRON_SECRET — склад читає той самий ключ.

import { kvRead } from "@/lib/kv";
import { getKyivYearMonth } from "./stock";

export function usdExchangeRateKey(year: number, month: number): string {
  return `finance:exchange-rate:usd:${year}:${month}`;
}

function parseRate(raw: string | null): number | null {
  if (raw == null) return null;
  let rate: number | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "number") rate = parsed;
    else if (typeof parsed === "object" && parsed !== null) {
      const val = (parsed as { value?: unknown }).value ?? parsed;
      if (typeof val === "number") rate = val;
      else if (typeof val === "string") rate = parseFloat(val);
    } else if (typeof parsed === "string") rate = parseFloat(parsed);
  } catch {
    rate = parseFloat(raw);
  }
  return Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : null;
}

export async function getUsdUahRate(year?: number, month?: number): Promise<{
  year: number;
  month: number;
  rate: number | null;
  key: string;
}> {
  const now = getKyivYearMonth();
  const y = year && year > 2000 ? year : now.year;
  const m = month && month >= 1 && month <= 12 ? month : now.month;
  const key = usdExchangeRateKey(y, m);
  const raw = await kvRead.getRaw(key);
  const rate = parseRate(typeof raw === "string" ? raw : raw == null ? null : String(raw));
  console.log(`[warehouse/fx] Курс USD/UAH ${y}-${String(m).padStart(2, "0")}: ${rate ?? "відсутній"}`);
  return { year: y, month: m, rate, key };
}

export async function requireUsdUahRate(year?: number, month?: number): Promise<{
  year: number;
  month: number;
  rate: number;
}> {
  const row = await getUsdUahRate(year, month);
  if (!(row.rate && row.rate > 0)) {
    throw new Error(
      `Відсутній курс долара за ${row.year}-${String(row.month).padStart(2, "0")}. Вкажіть курс у фінансовому звіті (блок 4), потім проведіть документ.`,
    );
  }
  return { year: row.year, month: row.month, rate: row.rate };
}
