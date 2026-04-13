// web/lib/altegio/staff-period-income.ts
// Виручка співробітника за період через Altegio API (узгоджено зі звітом «Продажі по співробітниках» / Виручка).
// МТД оборот у masters-stats: GET salary/period/staff/daily (total_sum по днях) → calculation → Z → GET /records (fallback).
// Тут: GET .../salary/period/staff/daily/{id} та salary/calculation/staff — fallback без Z-звіту.

import { AltegioHttpError, altegioFetch } from './client';
import { ALTEGIO_ENV } from './env';

export type StaffCalculationIncomeResult =
  | { ok: true; incomeUAH: number }
  | { ok: false; reason: string };

export function parseMoneyString(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  }
  return 0;
}

/** Денний рядок period_calculation: total_sum може бути числом, рядком або об'єктом з income (як у aggregate). */
function parseDayTotalSumField(totalSum: unknown): number {
  if (totalSum == null) return 0;
  if (typeof totalSum === 'number' || typeof totalSum === 'string') {
    return Math.max(0, parseMoneyString(totalSum));
  }
  if (typeof totalSum === 'object') {
    const o = totalSum as Record<string, unknown>;
    const incomeRaw = o.income ?? o.Income ?? o.sum ?? o.Sum;
    return Math.max(0, parseMoneyString(incomeRaw));
  }
  return 0;
}

/**
 * Altegio (search_team_member_period_daily_salary): `data.period_calculation_daily` — масив;
 * кожен елемент: `{ date, period_calculation: { total_sum, services_sum, goods_sales_sum, ... } }`,
 * де `period_calculation` — об'єкт одного дня, не масив.
 * Можлива альтернатива: один об'єкт з вкладеним масивом `period_calculation[]` (залишаємо підтримку).
 */
function extractDailyPeriodCalculationObjects(data: any): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const pcd = data.period_calculation_daily ?? data.periodCalculationDaily;

  if (Array.isArray(pcd)) {
    return pcd
      .map((entry: any) => entry?.period_calculation ?? entry?.periodCalculation)
      .filter((c) => c != null && typeof c === 'object');
  }

  if (pcd && typeof pcd === 'object') {
    const raw = (pcd as any).period_calculation ?? (pcd as any).periodCalculation;
    if (Array.isArray(raw)) return raw.filter((c: unknown) => c != null && typeof c === 'object');
    if (raw && typeof raw === 'object') return [raw];
  }
  return [];
}

function hasDailyPayrollShape(data: any): boolean {
  const pcd = data?.period_calculation_daily ?? data?.periodCalculationDaily;
  if (Array.isArray(pcd)) return true;
  if (!pcd || typeof pcd !== 'object') return false;
  return Array.isArray((pcd as any).period_calculation) || Array.isArray((pcd as any).periodCalculation);
}

/** ID філії для шляху /company/{id}/... */
export function resolveAltegioLocationIdNumeric(): number | null {
  const raw = (
    process.env.ALTEGIO_COMPANY_ID?.trim() ||
    ALTEGIO_ENV.PARTNER_ID ||
    ALTEGIO_ENV.APPLICATION_ID ||
    ''
  ).trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Оборот за період: сума по днях з `period_calculation` (інструкція Altegio «Getting payroll for a period…»).
 * За замовчуванням — **`total_sum`** (послуги + товар); опційно лише **`services_sum`**.
 * GET /company/{location_id}/salary/period/staff/daily/{team_member_id}
 */
export async function fetchStaffDailyPeriodTurnoverUAH(
  locationId: number,
  teamMemberId: number,
  dateFrom: string,
  dateTo: string,
  opts?: { servicesOnly?: boolean },
): Promise<StaffCalculationIncomeResult> {
  if (!Number.isFinite(locationId) || locationId <= 0 || !Number.isFinite(teamMemberId) || teamMemberId <= 0) {
    return { ok: false, reason: 'invalid_ids' };
  }

  const qs = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });
  const path = `company/${locationId}/salary/period/staff/daily/${teamMemberId}?${qs.toString()}`;

  try {
    const raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 25000);
    const data = raw?.data ?? raw;
    const dayCalcs = extractDailyPeriodCalculationObjects(data);
    const servicesOnly = opts?.servicesOnly === true;
    let incomeUAH = 0;
    for (const calc of dayCalcs) {
      const row = calc as Record<string, unknown>;
      let day: number;
      if (servicesOnly) {
        day = parseDayTotalSumField(row?.services_sum ?? row?.servicesSum);
      } else {
        day = parseDayTotalSumField(row?.total_sum ?? row?.totalSum);
        if (day <= 0) {
          const svc = parseDayTotalSumField(row?.services_sum ?? row?.servicesSum);
          const goods = parseDayTotalSumField(row?.goods_sales_sum ?? row?.goodsSalesSum);
          if (svc > 0 || goods > 0) day = svc + goods;
        }
      }
      incomeUAH += day;
    }
    incomeUAH = Math.round(incomeUAH * 100) / 100;

    console.log('[altegio/staff-period-income] ✅ Денний payroll (сума по днях)', {
      locationId,
      teamMemberId,
      dateFrom,
      dateTo,
      days: dayCalcs.length,
      incomeUAH,
      servicesOnly,
    });

    if (!hasDailyPayrollShape(data)) {
      console.warn(
        '[altegio/staff-period-income] ⚠️ daily payroll: неочікувана форма data (очікується period_calculation_daily як масив або об’єкт з period_calculation)',
        { locationId, teamMemberId, dateFrom, dateTo },
      );
      return { ok: false, reason: 'unrecognized_daily_payload' };
    }

    return { ok: true, incomeUAH };
  } catch (err) {
    if (err instanceof AltegioHttpError) {
      console.warn('[altegio/staff-period-income] ⚠️ Помилка API daily payroll', {
        locationId,
        teamMemberId,
        status: err.status,
        message: err.message,
      });
      return { ok: false, reason: `http_${err.status}` };
    }
    console.warn('[altegio/staff-period-income] ⚠️ Неочікувана помилка (daily)', {
      locationId,
      teamMemberId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'unknown' };
  }
}

/**
 * Дохід (виручка) майстра за період з розрахунку Altegio (агрегат за весь період).
 * При 403/404/мережевій помилці повертає ok:false — викликач може лишити fallback (наприклад Direct).
 */
export async function fetchStaffCalculationIncomeUAH(
  locationId: number,
  teamMemberId: number,
  dateFrom: string,
  dateTo: string,
): Promise<StaffCalculationIncomeResult> {
  if (!Number.isFinite(locationId) || locationId <= 0 || !Number.isFinite(teamMemberId) || teamMemberId <= 0) {
    return { ok: false, reason: 'invalid_ids' };
  }

  const qs = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });
  const path = `company/${locationId}/salary/calculation/staff/${teamMemberId}?${qs.toString()}`;

  try {
    const raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 25000);
    const data = raw?.data ?? raw;
    const d = data as Record<string, unknown>;
    const pc = (d?.period_calculation ?? d?.periodCalculation ?? data) as Record<string, unknown>;
    const totalSum = data?.total_sum ?? data?.totalSum;
    const incomeRaw = totalSum?.income ?? totalSum?.Income;
    const incomeTotalUAH = Math.max(0, parseMoneyString(incomeRaw));
    const svcPc = Math.max(0, parseMoneyString(d?.services_sum ?? d?.servicesSum ?? pc?.services_sum ?? pc?.servicesSum ?? 0));
    const goodsPc = Math.max(0, parseMoneyString(d?.goods_sales_sum ?? d?.goodsSalesSum ?? pc?.goods_sales_sum ?? pc?.goodsSalesSum ?? 0));
    /** Оборот як у daily payroll: пріоритет — агрегат `total_sum.income`, інакше services_sum + goods_sales_sum. */
    const incomeUAH =
      incomeTotalUAH > 0 ? incomeTotalUAH : Math.round((svcPc + goodsPc) * 100) / 100;

    console.log('[altegio/staff-period-income] ✅ Розрахунок співробітника', {
      locationId,
      teamMemberId,
      dateFrom,
      dateTo,
      incomeUAH,
      incomeTotalUAH,
      svcPc,
      goodsPc,
    });

    return { ok: true, incomeUAH };
  } catch (err) {
    if (err instanceof AltegioHttpError) {
      console.warn('[altegio/staff-period-income] ⚠️ Помилка API розрахунку', {
        locationId,
        teamMemberId,
        status: err.status,
        message: err.message,
      });
      return { ok: false, reason: `http_${err.status}` };
    }
    console.warn('[altegio/staff-period-income] ⚠️ Неочікувана помилка', {
      locationId,
      teamMemberId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'unknown' };
  }
}
