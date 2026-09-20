// Курс USD/UAH: пріоритет денного робочого курсу (Monobank sell → ceil+1),
// fallback — KV фінзвіту (блок 4). Live Monobank лише всередині getOrFixDailyFxRates.

import { kvRead } from "@/lib/kv";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { getOrFixDailyFxRates } from "@/lib/fx/daily-rates";
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

export type UsdUahRateSource = "daily_fx" | "finance_kv" | "none";

export async function getUsdUahRate(year?: number, month?: number): Promise<{
  year: number;
  month: number;
  rate: number | null;
  key: string;
  source: UsdUahRateSource;
  fetchedAt?: string;
  usdWorking?: number | null;
  eurWorking?: number | null;
  usdSell?: number | null;
  eurSell?: number | null;
  kyivDay?: string;
}> {
  const now = getKyivYearMonth();
  const y = year && year > 2000 ? year : now.year;
  const m = month && month >= 1 && month <= 12 ? month : now.month;

  // Робочий курс складу/каси — зафіксований на календарний день Kyiv (не live Mono).
  try {
    const today = kyivCalendarTodayYmd();
    const daily = await getOrFixDailyFxRates(today);
    if (daily && daily.usdWorking > 0) {
      console.log(
        `[warehouse/fx] Денний робочий курс ${daily.kyivDay}: USD ${daily.usdWorking} (sell ${daily.usdSell}), EUR ${daily.eurWorking}`,
      );
      return {
        year: y,
        month: m,
        rate: daily.usdWorking,
        key: `daily-fx:${daily.kyivDay}`,
        source: "daily_fx",
        fetchedAt: daily.fetchedAt,
        usdWorking: daily.usdWorking,
        eurWorking: daily.eurWorking,
        usdSell: daily.usdSell,
        eurSell: daily.eurSell,
        kyivDay: daily.kyivDay,
      };
    }
  } catch (err) {
    console.warn(
      "[warehouse/fx] Не вдалося отримати денний курс:",
      err instanceof Error ? err.message : err,
    );
  }

  const kv = await getKvUsdUahRate(y, m);
  console.log(
    `[warehouse/fx] Курс USD/UAH KV ${y}-${String(m).padStart(2, "0")}: ${kv.rate ?? "відсутній"} (денний курс недоступний)`,
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
  source: "daily_fx" | "finance_kv";
}> {
  const row = await getUsdUahRate(year, month);
  if (!(row.rate && row.rate > 0)) {
    throw new Error(
      `Немає курсу USD/UAH (денний курс недоступний, і в фінзвіті блок 4 немає курсу за ${row.year}-${String(row.month).padStart(2, "0")}).`,
    );
  }
  return {
    year: row.year,
    month: row.month,
    rate: row.rate,
    source: row.source === "finance_kv" ? "finance_kv" : "daily_fx",
  };
}
