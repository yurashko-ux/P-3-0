// web/lib/altegio/analytics.ts
// Фінансова аналітика (виручка, послуги, товари, середній чек) + денний графік

import { ALTEGIO_ENV } from "./env";
import { altegioFetch } from "./client";
import {
  AltegioOverallAnalytics,
  AltegioIncomeDailySeries,
  FinanceSummary,
} from "./types";

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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

  const companyId = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_PARTNER_ID or ALTEGIO_APPLICATION_ID is required for finance analytics",
    );
  }

  const basePath = `/company/${companyId}/analytics/overall`;
  const query = `?${qs.toString()}`;

  const [overall, incomeDailyRaw] = await Promise.all([
    altegioFetch<AltegioOverallAnalytics>(`${basePath}${query}`),
    altegioFetch<AltegioIncomeDailySeries[]>(
      `${basePath}/charts/income_daily${query}`,
    ),
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

