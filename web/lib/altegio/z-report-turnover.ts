// web/lib/altegio/z-report-turnover.ts
// Z-звіт (денний): GET /reports/z_report/{location_id}?start_date=YYYY-MM-DD
// У data.z_data — кошики по ключах; у кожному — масив візитів з masters[].service/good/others з полями
// first_cost, discount, result_cost. МТД: брутто (first_cost/cost) та знижка окремо, чиста сума = брутто − знижка.

import { AltegioHttpError, altegioFetch } from './client';
import { parseMoneyString } from './staff-period-income';

export type ZReportMtdByMasterResult =
  | { ok: true; byMasterId: Map<number, number>; daysRequested: number; daysSucceeded: number }
  | { ok: false; reason: string; daysRequested: number; daysSucceeded: number };

/** Календарні дати YYYY-MM-DD від from до to включно (UTC-арифметика для стабільності на сервері). */
export function eachDateInclusiveYMD(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromYmd.split('-').map((x) => parseInt(x, 10));
  const [ty, tm, td] = toYmd.split('-').map((x) => parseInt(x, 10));
  if (!fy || !fm || !fd || !ty || !tm || !td) return out;
  let t = Date.UTC(fy, fm - 1, fd);
  const endT = Date.UTC(ty, tm - 1, td);
  while (t <= endT) {
    const d = new Date(t);
    out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

function sumMasterBlockResultCost(master: any): number {
  let sum = 0;
  const services = master?.service ?? master?.services;
  if (Array.isArray(services)) {
    for (const item of services) {
      sum += parseMoneyString(item?.result_cost ?? item?.resultCost);
    }
  }
  const goods = master?.good ?? master?.goods;
  if (Array.isArray(goods)) {
    for (const item of goods) {
      sum += parseMoneyString(item?.result_cost ?? item?.resultCost);
    }
  }
  const others = master?.others;
  if (others != null && typeof others === 'object') {
    sum += parseMoneyString((others as any)?.result_cost ?? (others as any)?.resultCost);
  }
  return Math.round(sum * 100) / 100;
}

/** База до знижки по рядках Z (first_cost / cost). */
function sumMasterBlockFirstCostLines(master: any): number {
  let sum = 0;
  const addItems = (items: any) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const v = parseMoneyString(item?.first_cost ?? item?.firstCost ?? item?.cost ?? item?.Cost ?? 0);
      sum += v;
    }
  };
  addItems(master?.service ?? master?.services);
  addItems(master?.good ?? master?.goods);
  const others = master?.others;
  if (others != null && typeof others === 'object') {
    sum += parseMoneyString((others as any)?.first_cost ?? (others as any)?.cost ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

/** Сума знижок по рядках Z. */
function sumMasterBlockDiscountLines(master: any): number {
  let sum = 0;
  const addItems = (items: any) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      sum += Math.max(0, parseMoneyString(item?.discount ?? 0));
    }
  };
  addItems(master?.service ?? master?.services);
  addItems(master?.good ?? master?.goods);
  const others = master?.others;
  if (others != null && typeof others === 'object') {
    sum += Math.max(0, parseMoneyString((others as any)?.discount ?? 0));
  }
  return Math.round(sum * 100) / 100;
}

/** Додає до map суми result_cost по master_id за один день Z-звіту (для діагностики / порівняння). */
export function accumulateZDataResultCostByMaster(zData: unknown, into: Map<number, number>): void {
  if (!zData || typeof zData !== 'object') return;
  for (const bucket of Object.values(zData as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue;
    for (const clientRow of bucket) {
      const masters = (clientRow as any)?.masters;
      if (!Array.isArray(masters)) continue;
      for (const master of masters) {
        const mid = Number(master?.master_id ?? master?.masterId);
        if (!Number.isFinite(mid) || mid <= 0) continue;
        const add = sumMasterBlockResultCost(master);
        into.set(mid, Math.round(((into.get(mid) || 0) + add) * 100) / 100);
      }
    }
  }
}

/**
 * Два кроки на тих самих даних Z: брутто (first_cost/cost) і знижка; чистий оборот = брутто − знижка по master_id.
 */
export function accumulateZDataGrossDiscountByMaster(
  zData: unknown,
  grossInto: Map<number, number>,
  discountInto: Map<number, number>,
): void {
  if (!zData || typeof zData !== 'object') return;
  for (const bucket of Object.values(zData as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue;
    for (const clientRow of bucket) {
      const masters = (clientRow as any)?.masters;
      if (!Array.isArray(masters)) continue;
      for (const master of masters) {
        const mid = Number(master?.master_id ?? master?.masterId);
        if (!Number.isFinite(mid) || mid <= 0) continue;
        const g = sumMasterBlockFirstCostLines(master);
        const d = sumMasterBlockDiscountLines(master);
        grossInto.set(mid, Math.round(((grossInto.get(mid) || 0) + g) * 100) / 100);
        discountInto.set(mid, Math.round(((discountInto.get(mid) || 0) + d) * 100) / 100);
      }
    }
  }
}

export function mergeGrossMinusDiscountMaps(
  gross: Map<number, number>,
  discount: Map<number, number>,
): Map<number, number> {
  const net = new Map<number, number>();
  const ids = new Set([...gross.keys(), ...discount.keys()]);
  for (const id of ids) {
    const v = Math.max(0, Math.round(((gross.get(id) ?? 0) - (discount.get(id) ?? 0)) * 100) / 100);
    net.set(id, v);
  }
  return net;
}

/** Один запит Z-звіту за весь період (якщо API приймає end_date). */
async function tryZReportRangeSingleRequest(
  locationId: number,
  dateFromYmd: string,
  dateToYmd: string,
): Promise<Map<number, number> | null> {
  const qs = new URLSearchParams();
  qs.set('start_date', dateFromYmd);
  qs.set('end_date', dateToYmd);
  const path = `reports/z_report/${locationId}?${qs.toString()}`;
  try {
    const raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 25000);
    if (raw && raw.success === false) return null;
    const data = raw?.data ?? raw;
    const zData = data?.z_data ?? data?.zData;
    const grossMap = new Map<number, number>();
    const discMap = new Map<number, number>();
    accumulateZDataGrossDiscountByMaster(zData, grossMap, discMap);
    const map = mergeGrossMinusDiscountMaps(grossMap, discMap);
    const hasZ = zData && typeof zData === 'object' && Object.keys(zData as object).length > 0;
    if (!hasZ) return null;
    console.log('[altegio/z-report-turnover] ✅ Z-звіт один запит (start_date+end_date)', {
      locationId,
      dateFromYmd,
      dateToYmd,
      mastersInMap: map.size,
    });
    return map;
  } catch (err) {
    if (err instanceof AltegioHttpError && err.status === 422) {
      console.log('[altegio/z-report-turnover] ℹ️ Z-звіт range 422 — перейдемо на поденні запити', { locationId });
    } else {
      console.warn('[altegio/z-report-turnover] ⚠️ Z-звіт range помилка', {
        locationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Оборот МТД по всіх співробітниках: Z-звіт, чиста сума = сума first_cost/cost − сума discount по рядках.
 * Спочатку один запит start_date+end_date; інакше — по днях start_date=end_date=день (щоб не тягнути зайвий період).
 */
export async function fetchZReportMtdTurnoverByMasterId(
  locationId: number,
  dateFromYmd: string,
  dateToYmd: string,
  opts?: { delayMsBetweenDays?: number },
): Promise<ZReportMtdByMasterResult> {
  if (!Number.isFinite(locationId) || locationId <= 0) {
    return { ok: false, reason: 'invalid_location', daysRequested: 0, daysSucceeded: 0 };
  }
  const days = eachDateInclusiveYMD(dateFromYmd, dateToYmd);
  if (days.length === 0) {
    return { ok: false, reason: 'empty_date_range', daysRequested: 0, daysSucceeded: 0 };
  }

  const rangeMap = await tryZReportRangeSingleRequest(locationId, dateFromYmd, dateToYmd);
  if (rangeMap != null) {
    return {
      ok: true,
      byMasterId: rangeMap,
      daysRequested: days.length,
      daysSucceeded: 1,
    };
  }

  const delay = opts?.delayMsBetweenDays ?? 80;
  const grossByMasterId = new Map<number, number>();
  const discountByMasterId = new Map<number, number>();
  let daysSucceeded = 0;

  for (const day of days) {
    const qs = new URLSearchParams();
    qs.set('start_date', day);
    qs.set('end_date', day);
    const path = `reports/z_report/${locationId}?${qs.toString()}`;
    try {
      const raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 25000);
      if (raw && raw.success === false) {
        console.warn('[altegio/z-report-turnover] ⚠️ Z-звіт success=false', { locationId, day, meta: raw?.meta });
      } else {
        const data = raw?.data ?? raw;
        const zData = data?.z_data ?? data?.zData;
        accumulateZDataGrossDiscountByMaster(zData, grossByMasterId, discountByMasterId);
        daysSucceeded += 1;
        console.log('[altegio/z-report-turnover] ✅ День Z-звіту', {
          locationId,
          day,
          grossMasters: grossByMasterId.size,
          discountMasters: discountByMasterId.size,
        });
      }
    } catch (err) {
      if (err instanceof AltegioHttpError) {
        console.warn('[altegio/z-report-turnover] ⚠️ Помилка Z-звіту за день', {
          locationId,
          day,
          status: err.status,
          message: err.message,
        });
      } else {
        console.warn('[altegio/z-report-turnover] ⚠️ Неочікувана помилка Z-звіту', {
          locationId,
          day,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  if (daysSucceeded === 0) {
    return {
      ok: false,
      reason: 'no_days_succeeded',
      daysRequested: days.length,
      daysSucceeded: 0,
    };
  }
  const byMasterId = mergeGrossMinusDiscountMaps(grossByMasterId, discountByMasterId);
  return { ok: true, byMasterId, daysRequested: days.length, daysSucceeded };
}
