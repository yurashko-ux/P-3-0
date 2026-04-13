// web/lib/altegio/analytics.ts
// Фінансова аналітика (виручка, послуги, товари, середній чек) + денний графік

import { ALTEGIO_ENV } from "./env";
import { AltegioHttpError, altegioFetch } from "./client";
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

  // Для фінансової аналітики Altegio очікує ID локації/компанії,
  // який ми задаємо через окрему змінну ALTEGIO_COMPANY_ID.
  const companyIdFromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const companyId =
    companyIdFromEnv || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;

  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required (optionally can fall back to ALTEGIO_PARTNER_ID / ALTEGIO_APPLICATION_ID)",
    );
  }

  const basePath = `/company/${companyId}/analytics/overall`;
  const query = `?${qs.toString()}`;

  const [overallRaw, incomeDailyRaw] = await Promise.all([
    altegioFetch<any>(`${basePath}${query}`),
    altegioFetch<AltegioIncomeDailySeries[]>(
      `${basePath}/charts/income_daily${query}`,
    ),
  ]);

  // /company/{id}/analytics/overall повертає об’єкт виду { success, data, meta }
  const overall: AltegioOverallAnalytics =
    (overallRaw && typeof overallRaw === "object" && "data" in overallRaw
      ? (overallRaw as any).data
      : overallRaw) ?? {};

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

export type MasterIncomeDailyResult =
  | { ok: true; totalUAH: number }
  | { ok: false; reason: string };

function extractIncomeDailySeriesArray(raw: unknown): AltegioIncomeDailySeries[] {
  const r = raw as any;
  if (Array.isArray(r)) return r as AltegioIncomeDailySeries[];
  const d = r?.data;
  if (Array.isArray(d)) return d as AltegioIncomeDailySeries[];
  if (Array.isArray(d?.data)) return d.data as AltegioIncomeDailySeries[];
  return [];
}

/** Сума щоденних точок графіка виручки (узгоджено з аналітикою Altegio для звітів по майстру). */
function sumIncomeDailySeries(seriesList: AltegioIncomeDailySeries[]): number {
  if (!seriesList.length) return 0;
  const rev =
    seriesList.find((s) => /revenue|доход|income|виручка/i.test((s?.label || "").toString())) || seriesList[0];
  const pts = rev?.data;
  if (!Array.isArray(pts)) return 0;
  let t = 0;
  for (const p of pts) {
    if (Array.isArray(p) && p.length >= 2) t += Number(p[1]) || 0;
  }
  return Math.round(t * 100) / 100;
}

/**
 * Виручка майстра за період з графіка GET /company/{location_id}/analytics/overall/charts/income_daily
 * (date_from, date_to, team_member_id — як у документації «Get data on revenue by day»).
 */
export async function fetchMasterRevenueFromIncomeDailyChart(
  locationId: number,
  teamMemberId: number,
  dateFrom: string,
  dateTo: string,
): Promise<MasterIncomeDailyResult> {
  if (!Number.isFinite(locationId) || locationId <= 0 || !Number.isFinite(teamMemberId) || teamMemberId <= 0) {
    return { ok: false, reason: "invalid_ids" };
  }
  const qs = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
    team_member_id: String(teamMemberId),
  });
  const path = `company/${locationId}/analytics/overall/charts/income_daily?${qs.toString()}`;
  try {
    const raw = await altegioFetch<any>(path, { method: "GET" }, 2, 200, 25000);
    const arr = extractIncomeDailySeriesArray(raw);
    const totalUAH = sumIncomeDailySeries(arr);
    console.log("[altegio/analytics] ✅ income_daily по майстру", {
      locationId,
      teamMemberId,
      dateFrom,
      dateTo,
      totalUAH,
      seriesCount: arr.length,
    });
    return { ok: true, totalUAH };
  } catch (err) {
    if (err instanceof AltegioHttpError) {
      console.warn("[altegio/analytics] ⚠️ income_daily помилка", {
        locationId,
        teamMemberId,
        status: err.status,
        message: err.message,
      });
      return { ok: false, reason: `http_${err.status}` };
    }
    console.warn("[altegio/analytics] ⚠️ income_daily неочікувана помилка", {
      locationId,
      teamMemberId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "unknown" };
  }
}


