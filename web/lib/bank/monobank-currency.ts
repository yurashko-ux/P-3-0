// Публічний курс валют Monobank (без токена).
// GET https://api.monobank.ua/bank/currency — оновлення не частіше ~5 хв.

const MONO_CURRENCY_URL = "https://api.monobank.ua/bank/currency";
const USD = 840;
const UAH = 980;

/** Кеш у пам'яті процесу (Vercel cold start скидає). */
let cache: { atMs: number; rateBuy: number; rateSell: number | null; rateCross: number | null } | null =
  null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type MonobankUsdUahRate = {
  rate: number;
  rateBuy: number;
  rateSell: number | null;
  rateCross: number | null;
  source: "monobank";
  fetchedAt: string;
};

function pickAcceptCashRate(row: {
  rateBuy?: number;
  rateSell?: number;
  rateCross?: number;
}): number | null {
  // Приймаємо готівкові $ від клієнта ≈ курс купівлі банку (rateBuy), інакше cross/sell.
  const buy = Number(row.rateBuy);
  if (Number.isFinite(buy) && buy > 0) return buy;
  const cross = Number(row.rateCross);
  if (Number.isFinite(cross) && cross > 0) return cross;
  const sell = Number(row.rateSell);
  if (Number.isFinite(sell) && sell > 0) return sell;
  return null;
}

export async function fetchMonobankUsdUahRate(opts?: {
  force?: boolean;
}): Promise<MonobankUsdUahRate | null> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.atMs < CACHE_TTL_MS) {
    return {
      rate: cache.rateBuy,
      rateBuy: cache.rateBuy,
      rateSell: cache.rateSell,
      rateCross: cache.rateCross,
      source: "monobank",
      fetchedAt: new Date(cache.atMs).toISOString(),
    };
  }

  try {
    const res = await fetch(MONO_CURRENCY_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Публічний endpoint; не кешуємо агресивно на CDN — у нас свій TTL.
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[monobank/currency] HTTP ${res.status}`);
      return cache
        ? {
            rate: cache.rateBuy,
            rateBuy: cache.rateBuy,
            rateSell: cache.rateSell,
            rateCross: cache.rateCross,
            source: "monobank",
            fetchedAt: new Date(cache.atMs).toISOString(),
          }
        : null;
    }
    const raw = (await res.json()) as Array<{
      currencyCodeA?: number;
      currencyCodeB?: number;
      rateBuy?: number;
      rateSell?: number;
      rateCross?: number;
    }>;
    if (!Array.isArray(raw)) {
      console.warn("[monobank/currency] Неочікувана відповідь (не масив)");
      return null;
    }
    const row = raw.find(
      (r) => Number(r.currencyCodeA) === USD && Number(r.currencyCodeB) === UAH,
    );
    if (!row) {
      console.warn("[monobank/currency] Немає пари USD/UAH (840/980)");
      return null;
    }
    const rate = pickAcceptCashRate(row);
    if (!(rate && rate > 0)) {
      console.warn("[monobank/currency] Порожні rateBuy/rateCross/rateSell");
      return null;
    }
    const rateSell = Number(row.rateSell);
    const rateCross = Number(row.rateCross);
    cache = {
      atMs: now,
      rateBuy: rate,
      rateSell: Number.isFinite(rateSell) && rateSell > 0 ? rateSell : null,
      rateCross: Number.isFinite(rateCross) && rateCross > 0 ? rateCross : null,
    };
    console.log(
      `[monobank/currency] USD/UAH rate=${rate} (buy=${row.rateBuy ?? "—"} sell=${row.rateSell ?? "—"} cross=${row.rateCross ?? "—"})`,
    );
    return {
      rate,
      rateBuy: rate,
      rateSell: cache.rateSell,
      rateCross: cache.rateCross,
      source: "monobank",
      fetchedAt: new Date(now).toISOString(),
    };
  } catch (err) {
    console.warn(
      "[monobank/currency] Помилка запиту:",
      err instanceof Error ? err.message : err,
    );
    return cache
      ? {
          rate: cache.rateBuy,
          rateBuy: cache.rateBuy,
          rateSell: cache.rateSell,
          rateCross: cache.rateCross,
          source: "monobank",
          fetchedAt: new Date(cache.atMs).toISOString(),
        }
      : null;
  }
}
