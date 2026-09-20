// Публічний курс валют Monobank (без токена).
// GET https://api.monobank.ua/bank/currency — оновлення не частіше ~5 хв.
// Беремо лише rateBuy (купка банку) для USD і EUR.

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
  rateBuy: number;
  rateSell: number | null;
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
  rateBuy: number;
  rateSell: number | null;
  rateCross: number | null;
  source: "monobank";
  fetchedAt: string;
};

let cache: { atMs: number; snapshot: MonobankCurrencySnapshot } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function pickBuyOnly(row: MonoRow): number | null {
  const buy = Number(row.rateBuy);
  if (Number.isFinite(buy) && buy > 0) return buy;
  return null;
}

function toPair(row: MonoRow | undefined): MonobankFxPair | null {
  if (!row) return null;
  const rateBuy = pickBuyOnly(row);
  if (!(rateBuy && rateBuy > 0)) return null;
  const rateSell = Number(row.rateSell);
  const rateCross = Number(row.rateCross);
  return {
    rateBuy,
    rateSell: Number.isFinite(rateSell) && rateSell > 0 ? rateSell : null,
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
      console.warn("[monobank/currency] Немає rateBuy USD/UAH (840/980)");
      return cache?.snapshot ?? null;
    }
    const eur = toPair(eurRow);
    if (!eur) {
      console.warn("[monobank/currency] Немає rateBuy EUR/UAH (978/980) — EUR буде null");
    }
    const snapshot: MonobankCurrencySnapshot = {
      usd,
      eur,
      source: "monobank",
      fetchedAt: new Date(now).toISOString(),
    };
    cache = { atMs: now, snapshot };
    console.log(
      `[monobank/currency] buy USD=${usd.rateBuy} EUR=${eur?.rateBuy ?? "—"}`,
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

/** Зворотна сумісність: лише USD rateBuy. */
export async function fetchMonobankUsdUahRate(opts?: {
  force?: boolean;
}): Promise<MonobankUsdUahRate | null> {
  const snap = await fetchMonobankCurrencySnapshot(opts);
  if (!snap?.usd?.rateBuy) return null;
  return {
    rate: snap.usd.rateBuy,
    rateBuy: snap.usd.rateBuy,
    rateSell: snap.usd.rateSell,
    rateCross: snap.usd.rateCross,
    source: "monobank",
    fetchedAt: snap.fetchedAt,
  };
}
