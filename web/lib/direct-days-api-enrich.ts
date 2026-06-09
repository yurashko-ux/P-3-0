// web/lib/direct-days-api-enrich.ts
// API-fallback для колонки «Днів», коли KV не містить повної історії платних візитів.

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { loadAltegioRecordGroupsForClient } from '@/lib/direct-reconcile-altegio-record-status';
import {
  computePaidDaysSinceLastVisitOnKyivDay,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';

type DaysApiEnrichClient = {
  id: string;
  altegioClientId?: number | null;
  spent?: number | null;
  paidRecordsInHistoryCount?: number | null;
  daysSinceLastVisit?: number;
};

function resolveRefDay(referenceKyivDay?: string): string {
  const raw = (referenceKyivDay || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return kyivDayFromISO(new Date().toISOString());
}

function clientNeedsDaysApiFallback(c: DaysApiEnrichClient): boolean {
  if (typeof c.daysSinceLastVisit === 'number' && Number.isFinite(c.daysSinceLastVisit)) {
    return false;
  }
  const altegioId = Number(c.altegioClientId);
  if (!Number.isFinite(altegioId) || altegioId <= 0) return false;
  const spent = Number(c.spent ?? 0);
  const paidRecords = Number((c as { paidRecordsInHistoryCount?: number | null }).paidRecordsInHistoryCount ?? 0);
  return spent > 0 || paidRecords > 0;
}

/**
 * Для клієнтів без daysSinceLastVisit після KV — повна історія з Altegio API
 * (як у модалці «Історія записів»).
 */
export async function enrichClientsMissingDaysFromAltegioApi<T extends DaysApiEnrichClient>(
  clients: T[],
  referenceKyivDay?: string,
  maxApi = 32
): Promise<T[]> {
  const refDay = resolveRefDay(referenceKyivDay);
  const missing = clients.filter(clientNeedsDaysApiFallback).slice(0, maxApi);
  if (!missing.length) return clients;

  const patches = new Map<string, number>();
  for (const c of missing) {
    const altegioId = Number(c.altegioClientId);
    try {
      const { allGroups } = await loadAltegioRecordGroupsForClient(altegioId);
      const days = computePaidDaysSinceLastVisitOnKyivDay(
        c as LastAttendedVisitClient,
        refDay,
        allGroups
      );
      if (days !== undefined) {
        patches.set(c.id, days);
        console.log('[direct-days-api-enrich] ✅ days з API', {
          altegioClientId: altegioId,
          days,
        });
      }
    } catch (err) {
      console.warn('[direct-days-api-enrich] ⚠️ API fallback не вдався:', {
        altegioClientId: altegioId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!patches.size) return clients;
  return clients.map((c) => {
    const days = patches.get(c.id);
    return days !== undefined ? ({ ...c, daysSinceLastVisit: days } as T) : c;
  });
}
