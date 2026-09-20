// Курс USD/UAH: пріоритет Monobank (live), fallback — KV фінзвіту (блок 4).

import { kvRead } from "@/lib/kv";
import { fetchMonobankUsdUahRate } from "@/lib/bank/monobank-currency";
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

async function getKvUsdUahRate(year?: number, month?: number): Promise<{
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
  return { year: y, month: m, rate, key };
}

export async function getUsdUahRate(year?: number, month?: number): Promise<{
  year: number;
  month: number;
  rate: number | null;
  key: string;
  source: "monobank" | "finance_kv" | "none";
  fetchedAt?: string;
}> {
  const now = getKyivYearMonth();
  const y = year && year > 2000 ? year : now.year;
  const m = month && month >= 1 && month <= 12 ? month : now.month;

  const mono = await fetchMonobankUsdUahRate();
  if (mono?.rate && mono.rate > 0) {
    console.log(`[warehouse/fx] Курс USD/UAH з Monobank: ${mono.rate}`);
    return {
      year: y,
      month: m,
      rate: mono.rate,
      key: "monobank:usd-uah",
      source: "monobank",
      fetchedAt: mono.fetchedAt,
    };
  }

  const kv = await getKvUsdUahRate(y, m);
  console.log(
    `[warehouse/fx] Курс USD/UAH KV ${y}-${String(m).padStart(2, "0")}: ${kv.rate ?? "відсутній"} (Monobank недоступний)`,
  );
  return {
    year: kv.year,
    month: kv.month,
    rate: kv.rate,
    key: kv.key,
    source: kv.rate ? "finance_kv" : "none",
  };
}

export async function requireUsdUahRate(year?: number, month?: number): Promise<{
  year: number;
  month: number;
  rate: number;
  source: "monobank" | "finance_kv";
}> {
  const row = await getUsdUahRate(year, month);
  if (!(row.rate && row.rate > 0)) {
    throw new Error(
      `Немає курсу USD/UAH (Monobank недоступний, і в фінзвіті блок 4 немає курсу за ${row.year}-${String(row.month).padStart(2, "0")}).`,
    );
  }
  return {
    year: row.year,
    month: row.month,
    rate: row.rate,
    source: row.source === "finance_kv" ? "finance_kv" : "monobank",
  };
}
