// web/lib/altegio/staff-period-income.ts
// Виручка співробітника за період через Altegio API (узгоджено зі звітом «Продажі по співробітниках» / Виручка).
// GET /company/{location_id}/salary/calculation/staff/{team_member_id}?date_from&date_to
// Документація: search_team_member_calculation_salary.md — data.total_sum.income

import { AltegioHttpError, altegioFetch } from './client';
import { ALTEGIO_ENV } from './env';

export type StaffCalculationIncomeResult =
  | { ok: true; incomeUAH: number }
  | { ok: false; reason: string };

function parseMoneyString(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  }
  return 0;
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
 * Дохід (виручка) майстра за період з розрахунку Altegio.
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
    const totalSum = data?.total_sum ?? data?.totalSum;
    const incomeRaw = totalSum?.income ?? totalSum?.Income;
    const incomeUAH = Math.max(0, parseMoneyString(incomeRaw));

    console.log('[altegio/staff-period-income] ✅ Розрахунок співробітника', {
      locationId,
      teamMemberId,
      dateFrom,
      dateTo,
      incomeUAH,
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
