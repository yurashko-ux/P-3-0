// Публічний курс валют Monobank (без токена).
// GET https://api.monobank.ua/bank/currency — оновлення не частіше ~5 хв.
// Для робочого курсу беремо rateSell (продаж банку) для USD і EUR.

const MONO_CURRENCY_URL = "https://api.monobank.ua/bank/currency";
const USD = 840;
const EUR = 978;
const UAH = 980;

type MonoRow = {
  currencyCodeA?: number;
  currencyCodeB?: number;
  rateBuy?: number;
  rateSell?: number;
  rateCross?: number;
};

export type MonobankFxPair = {
  rateBuy: number | null;
  rateSell: number;
  rateCross: number | null;
};

export type MonobankCurrencySnapshot = {
  usd: MonobankFxPair;
  eur: MonobankFxPair | null;
  source: "monobank";
  fetchedAt: string;
};

/** @deprecated використовуйте fetchMonobankCurrencySnapshot */
export type MonobankUsdUahRate = {
  rate: number;
  rateBuy: number | null;
  rateSell: number;
  rateCross: number | null;
  source: "monobank";
  fetchedAt: string;
};

let cache: { atMs: number; snapshot: MonobankCurrencySnapshot } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function pickSellOnly(row: MonoRow): number | null {
  const sell = Number(row.rateSell);
  if (Number.isFinite(sell) && sell > 0) return sell;
  return null;
}

function toPair(row: MonoRow | undefined): MonobankFxPair | null {
  if (!row) return null;
  const rateSell = pickSellOnly(row);
  if (!(rateSell && rateSell > 0)) return null;
  const rateBuy = Number(row.rateBuy);
  const rateCross = Number(row.rateCross);
  return {
    rateBuy: Number.isFinite(rateBuy) && rateBuy > 0 ? rateBuy : null,
    rateSell,
    rateCross: Number.isFinite(rateCross) && rateCross > 0 ? rateCross : null,
  };
}

export async function fetchMonobankCurrencySnapshot(opts?: {
  force?: boolean;
}): Promise<MonobankCurrencySnapshot | null> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.atMs < CACHE_TTL_MS) {
    return cache.snapshot;
  }

  try {
    const res = await fetch(MONO_CURRENCY_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[monobank/currency] HTTP ${res.status}`);
      return cache?.snapshot ?? null;
    }
    const raw = (await res.json()) as MonoRow[];
    if (!Array.isArray(raw)) {
      console.warn("[monobank/currency] Неочікувана відповідь (не масив)");
      return null;
    }
    const usdRow = raw.find(
      (r) => Number(r.currencyCodeA) === USD && Number(r.currencyCodeB) === UAH,
    );
    const eurRow = raw.find(
      (r) => Number(r.currencyCodeA) === EUR && Number(r.currencyCodeB) === UAH,
    );
    const usd = toPair(usdRow);
    if (!usd) {
      console.warn("[monobank/currency] Немає rateSell USD/UAH (840/980)");
      return cache?.snapshot ?? null;
    }
    const eur = toPair(eurRow);
    if (!eur) {
      console.warn("[monobank/currency] Немає rateSell EUR/UAH (978/980) — EUR буде null");
    }
    const snapshot: MonobankCurrencySnapshot = {
      usd,
      eur,
      source: "monobank",
      fetchedAt: new Date(now).toISOString(),
    };
    cache = { atMs: now, snapshot };
    console.log(
      `[monobank/currency] sell USD=${usd.rateSell} EUR=${eur?.rateSell ?? "—"}`,
    );
    return snapshot;
  } catch (err) {
    console.warn(
      "[monobank/currency] Помилка запиту:",
      err instanceof Error ? err.message : err,
    );
    return cache?.snapshot ?? null;
  }
}

/** Зворотна сумісність: основне поле rate = USD rateSell. */
export async function fetchMonobankUsdUahRate(opts?: {
  force?: boolean;
}): Promise<MonobankUsdUahRate | null> {
  const snap = await fetchMonobankCurrencySnapshot(opts);
  if (!snap?.usd?.rateSell) return null;
  return {
    rate: snap.usd.rateSell,
    rateBuy: snap.usd.rateBuy,
    rateSell: snap.usd.rateSell,
    rateCross: snap.usd.rateCross,
    source: "monobank",
    fetchedAt: snap.fetchedAt,
  };
}
