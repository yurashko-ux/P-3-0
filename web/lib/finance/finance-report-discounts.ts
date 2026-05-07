import { ALTEGIO_ENV } from "@/lib/altegio";
import { fetchMtdDiscountSourcesByStaffId } from "@/lib/altegio/mtd-discount";
import {
  fetchServiceDiscountVisitDetails,
  type DiscountVisitDetail,
} from "@/lib/altegio/records";
import {
  fetchZReportDiscountVisitDetails,
  fetchZReportMtdTurnoverByMasterId,
} from "@/lib/altegio/z-report-turnover";

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month: number): {
  from: string;
  to: string;
} {
  const fromDate = new Date(year, month - 1, 1);
  const toDate = new Date(year, month, 0);
  return {
    from: formatDateISO(fromDate),
    to: formatDateISO(toDate),
  };
}

function sumMoneyMapValues(values: Map<number, number>): number {
  let total = 0;
  for (const value of values.values()) {
    total += Number(value) || 0;
  }
  return Math.round(total * 100) / 100;
}

export function resolveAltegioLocationIdForFinanceReport(): number | null {
  const raw =
    process.env.ALTEGIO_COMPANY_ID?.trim() ||
    ALTEGIO_ENV.PARTNER_ID ||
    ALTEGIO_ENV.APPLICATION_ID ||
    "";
  const locationId = Number(raw);
  return Number.isFinite(locationId) && locationId > 0 ? locationId : null;
}

function getTodayKyivDayForFinanceReport(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function getFinanceReportDiscountPeriod(year: number, month: number): { start: string; end: string } | null {
  const { from, to } = monthRange(year, month);
  const reportMonth = `${year}-${String(month).padStart(2, "0")}`;
  const todayKyivDay = getTodayKyivDayForFinanceReport();
  const todayMonth = todayKyivDay.slice(0, 7);

  if (reportMonth > todayMonth) return null;

  return {
    start: from,
    end: reportMonth === todayMonth ? todayKyivDay : to,
  };
}

export async function fetchFinanceReportDiscountTotal(year: number, month: number): Promise<number> {
  const period = getFinanceReportDiscountPeriod(year, month);
  if (!period) {
    console.warn("[finance-report] Знижка зі статистики не рахується для майбутнього звітного місяця", {
      year,
      month,
    });
    return 0;
  }

  const locationId = resolveAltegioLocationIdForFinanceReport();
  if (!locationId) {
    console.warn("[finance-report] Не вдалося отримати знижку: ALTEGIO_COMPANY_ID не налаштовано або невалідний");
    return 0;
  }

  try {
    const zDiscountSrc = await fetchZReportMtdTurnoverByMasterId(locationId, period.start, period.end);
    if (zDiscountSrc.ok) {
      const totalDiscount = sumMoneyMapValues(zDiscountSrc.discountByMasterId);
      console.log("[finance-report] 📊 Знижка для фінзвіту із Z-звіту:", {
        locationId,
        year,
        month,
        periodStart: period.start,
        periodEnd: period.end,
        totalDiscount,
        zDaysSucceeded: zDiscountSrc.daysSucceeded,
      });
      return totalDiscount;
    }

    const discounts = await fetchMtdDiscountSourcesByStaffId(locationId, period.start, period.end, {
      countPerPage: 1000,
      delayMs: 80,
      maxPages: 80,
    });
    const servicesDiscount = sumMoneyMapValues(discounts.servicesDiscountByStaffId);
    const storageDiscount = sumMoneyMapValues(discounts.storageDiscountByStaffId);
    const totalDiscount = Math.round((servicesDiscount + storageDiscount) * 100) / 100;
    console.log("[finance-report] 📊 Знижка для фінзвіту fallback із records:", {
      locationId,
      year,
      month,
      periodStart: period.start,
      periodEnd: period.end,
      zReason: zDiscountSrc.ok === false ? zDiscountSrc.reason : "unknown",
      servicesDiscount,
      storageDiscount,
      totalDiscount,
      recordsOk: discounts.recordsOk,
      recordsScanned: discounts.recordsScanned,
      recordsReason: discounts.recordsReason,
    });
    return totalDiscount;
  } catch (err) {
    console.warn(
      "[finance-report] Не вдалося отримати суму знижки:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

export async function fetchFinanceReportDiscountDetails(year: number, month: number): Promise<DiscountVisitDetail[]> {
  const period = getFinanceReportDiscountPeriod(year, month);
  if (!period) return [];

  const locationId = resolveAltegioLocationIdForFinanceReport();
  if (!locationId) return [];

  const zDetails = await fetchZReportDiscountVisitDetails(locationId, period.start, period.end, {
    delayMsBetweenDays: 80,
  });
  if (zDetails.ok && zDetails.details.length > 0) {
    console.log("[finance-report] 📊 Деталізація знижок із Z-звіту:", {
      year,
      month,
      rows: zDetails.details.length,
      total: zDetails.total,
      daysSucceeded: zDetails.daysSucceeded,
    });
    return zDetails.details;
  }

  if (zDetails.ok === false) {
    console.warn("[finance-report] Не вдалося отримати деталізацію знижок із Z-звіту, fallback на records:", {
      year,
      month,
      reason: zDetails.reason,
      partialTotal: zDetails.total,
      partialRows: zDetails.details.length,
    });
  }

  const result = await fetchServiceDiscountVisitDetails(locationId, period.start, period.end, {
    countPerPage: 1000,
    delayMs: 80,
    maxPages: 80,
  });

  if (result.ok === false) {
    console.warn("[finance-report] Не вдалося отримати деталізацію знижок по візитах:", {
      year,
      month,
      reason: result.reason,
      partialDetails: result.details.length,
      partialTotal: result.total,
    });
  }

  return result.details;
}
