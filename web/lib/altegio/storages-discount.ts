// web/lib/altegio/storages-discount.ts
// GET /storages/transactions/{location_id} — знижки по товарах за період (поле discount), агрегат по master.id

import { AltegioHttpError, altegioFetch } from './client';
import { parseMoneyString } from './staff-period-income';

/**
 * Сума полів discount по транзакціях складу, згрупована по master.id (співробітник).
 */
export async function fetchStoragesTransactionsDiscountByStaffId(
  locationId: number,
  startDateYmd: string,
  endDateYmd: string,
  opts?: { countPerPage?: number; maxPages?: number; delayMs?: number },
): Promise<Map<number, number>> {
  const into = new Map<number, number>();
  if (!Number.isFinite(locationId) || locationId <= 0) return into;

  const countPerPage = Math.min(1000, Math.max(50, opts?.countPerPage ?? 200));
  const maxPages = Math.max(1, opts?.maxPages ?? 100);
  const delayMs = Math.max(0, opts?.delayMs ?? 50);

  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      start_date: startDateYmd,
      end_date: endDateYmd,
      page: String(page),
      count: String(countPerPage),
    });
    const path = `storages/transactions/${locationId}?${qs.toString()}`;
    let raw: any;
    try {
      raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 45000);
    } catch (err) {
      console.warn('[altegio/storages-discount] ⚠️ storages/transactions', {
        locationId,
        page,
        error: err instanceof AltegioHttpError ? err.status : err instanceof Error ? err.message : String(err),
      });
      break;
    }

    const list: any[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as any).data)
        ? (raw as any).data
        : [];

    for (const tx of list) {
      const master = tx?.master;
      const mid = Number(
        (master && typeof master === 'object' ? master.id : null) ??
          tx?.master_id ??
          (typeof tx?.master === 'number' ? tx.master : null),
      );
      if (!Number.isFinite(mid) || mid <= 0) continue;
      const d = Math.max(0, parseMoneyString(tx?.discount ?? tx?.discount_sum ?? 0));
      if (d <= 0) continue;
      into.set(mid, Math.round(((into.get(mid) || 0) + d) * 100) / 100);
    }

    if (list.length < countPerPage) break;
    const totalMeta = (raw as any)?.meta?.total_count;
    if (totalMeta != null && page * countPerPage >= Number(totalMeta)) break;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log('[altegio/storages-discount] ✅ знижки по складу по staff_id', {
    locationId,
    startDateYmd,
    endDateYmd,
    distinctStaff: into.size,
  });

  return into;
}
