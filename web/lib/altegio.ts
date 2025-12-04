// web/lib/altegio.ts
//
// Невеликий клієнт для Altegio REST API (B2B).

import { ENV, altegioHeaders, altegioUrl, assertAltegioEnv } from "./env";

export type AltegioOverallAnalytics = {
  income_total_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_services_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_goods_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_average_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
};

export type AltegioIncomeDailySeries = {
  label?: string;
  data?: [string, number][];
};

export type FinanceSummary = {
  range: { date_from: string; date_to: string };
  currency: string;
  totals: {
    total: number;
    services: number;
    goods: number;
    avgCheck: number | null;
  };
  incomeDaily: { date: string; value: number }[];
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Базовий fetch до Altegio з обробкою JSON/помилок */
export async function altegioFetchJson<T = any>(path: string, search?: URLSearchParams): Promise<T> {
  assertAltegioEnv();
  const url = search ? `${altegioUrl(path)}?${search.toString()}` : altegioUrl(path);

  const res = await fetch(url, {
    method: "GET",
    headers: altegioHeaders(),
    cache: "no-store",
  });

  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg =
      (payload && (payload.error || payload.message || payload.meta?.message)) ||
      `Altegio error ${res.status}`;
    throw new Error(msg);
  }

  // Altegio зазвичай загортає дані у { success, data, meta }
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as any).data as T;
  }
  return payload as T;
}

/** Отримати узагальнену фінансову аналітику + денний графік по виручці */
export async function fetchFinanceSummary(params: {
  date_from: string;
  date_to: string;
}): Promise<FinanceSummary> {
  const { date_from, date_to } = params;

  const qs = new URLSearchParams({
    date_from,
    date_to,
  });

  const companyId = ENV.ALTEGIO_COMPANY_ID;

  const [overall, incomeDailyRaw] = await Promise.all([
    altegioFetchJson<AltegioOverallAnalytics>(`/company/${companyId}/analytics/overall`, qs),
    altegioFetchJson<AltegioIncomeDailySeries[]>(`/company/${companyId}/analytics/overall/charts/income_daily`, qs),
  ]);

  const currency =
    overall?.income_total_stats?.currency?.symbol ||
    overall?.income_services_stats?.currency?.symbol ||
    overall?.income_goods_stats?.currency?.symbol ||
    "₴";

  const totals = {
    total: toNumber(overall?.income_total_stats?.current_sum),
    services: toNumber(overall?.income_services_stats?.current_sum),
    goods: toNumber(overall?.income_goods_stats?.current_sum),
    avgCheck: overall?.income_average_stats
      ? toNumber(overall.income_average_stats.current_sum)
      : null,
  };

  // income_daily: масив серій; беремо першу (виручка) або шукаємо label з "revenue"/"доход"
  const series =
    incomeDailyRaw?.find((s) =>
      (s.label || "").toLowerCase().includes("revenue"),
    ) || incomeDailyRaw?.[0];

  const incomeDaily =
    series?.data?.map(([date, value]) => ({
      date,
      value: Number(value) || 0,
    })) ?? [];

  return {
    range: { date_from, date_to },
    currency,
    totals,
    incomeDaily,
  };
}

