// Той самий пайплайн «Днів», що в Direct: Prisma → групи Altegio/KV → API fallback.
// Для неактивної бази: додатковий Altegio re-verify кандидатів зі списку 101+ днів.

import { loadAltegioRecordGroupsForClient } from '@/lib/direct-reconcile-altegio-record-status';
import {
  loadAllConsultGroupsByClient,
  loadConsultGroupsByAltegioIds,
} from '@/lib/direct-consultation-master-sync';
import { enrichClientsMissingDaysFromAltegioApi } from '@/lib/direct-days-api-enrich';
import {
  ACTIVE_BASE_MAX_DAYS,
  computeDaysSinceLastVisit,
  computePaidDaysSinceLastVisitOnKyivDay,
  enrichClientsDaysFromRecordGroups,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

type DaysEnrichClient = LastAttendedVisitClient & {
  id: string;
  altegioClientId?: number | null;
  daysSinceLastVisit?: number;
  spent?: number | null;
  paidRecordsInHistoryCount?: number | null;
};

function resolveRefDay(referenceKyivDay?: string): string {
  const raw = (referenceKyivDay || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return kyivDayFromISO(new Date().toISOString());
}

async function loadRecordGroupsForClients(
  clients: Array<{ altegioClientId?: number | null }>
): Promise<Map<number, import('@/lib/altegio/records-grouping').RecordGroup[]>> {
  const altegioIds = [
    ...new Set(
      clients
        .map((c) => Number(c.altegioClientId))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (!altegioIds.length) return new Map();
  try {
    if (altegioIds.length <= 150) {
      return await loadConsultGroupsByAltegioIds(altegioIds);
    }
    return await loadAllConsultGroupsByClient();
  } catch (err) {
    console.warn('[inactive-base/enrich-days] loadRecordGroups не вдалось:', err);
    return new Map();
  }
}

/**
 * Перезапитати Altegio для клієнтів зі списку неактивної бази:
 * Prisma/KV можуть показувати 101+, тоді як у Altegio вже є свіжий візит.
 */
export async function reverifyInactiveCandidatesFromAltegioApi<T extends DaysEnrichClient>(
  clients: (T & { daysSinceLastVisit?: number })[],
  referenceKyivDay: string | undefined,
  maxApi: number
): Promise<(T & { daysSinceLastVisit?: number })[]> {
  if (maxApi <= 0 || !clients.length) return clients;

  const refDay = resolveRefDay(referenceKyivDay);
  const candidates = clients
    .filter((c) => {
      const altegioId = Number(c.altegioClientId);
      if (!Number.isFinite(altegioId) || altegioId <= 0) return false;
      const d = c.daysSinceLastVisit;
      if (typeof d !== 'number' || !Number.isFinite(d)) return true;
      return d > ACTIVE_BASE_MAX_DAYS;
    })
    .slice(0, maxApi);

  if (!candidates.length) return clients;

  console.log(
    `[inactive-base/enrich-days] Altegio re-verify для ${candidates.length}/${clients.length} з неактивної бази (max=${maxApi})`
  );

  const patches = new Map<string, number>();
  const concurrency = 4;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (c) => {
        const altegioId = Number(c.altegioClientId);
        try {
          const { allGroups } = await loadAltegioRecordGroupsForClient(altegioId, {
            strategy: 'kv-first',
            apiTimeoutMs: 12_000,
          });
          const days = computePaidDaysSinceLastVisitOnKyivDay(
            c as LastAttendedVisitClient,
            refDay,
            allGroups
          );
          if (days !== undefined) {
            patches.set(c.id, days);
          }
        } catch (err) {
          console.warn('[inactive-base/enrich-days] Altegio re-verify не вдався:', {
            altegioClientId: altegioId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  }

  if (!patches.size) return clients;
  console.log(`[inactive-base/enrich-days] Оновлено днів з Altegio: ${patches.size}`);
  return clients.map((c) => {
    const days = patches.get(c.id);
    return days !== undefined
      ? ({ ...c, daysSinceLastVisit: days } as T & { daysSinceLastVisit?: number })
      : c;
  });
}

/**
 * Дні з останнього платного візиту — як колонка «Днів» у Direct.
 * @param maxApiFallback 0 = без Altegio API (швидкий шлях для лічильників).
 */
export async function enrichClientsDaysLikeDirect<T extends DaysEnrichClient>(
  clients: T[],
  referenceKyivDay?: string,
  maxApiFallback = 16
): Promise<(T & { daysSinceLastVisit?: number })[]> {
  if (!clients.length) return clients as (T & { daysSinceLastVisit?: number })[];

  const refDay = resolveRefDay(referenceKyivDay);
  const withPrismaDays = computeDaysSinceLastVisit(clients);
  const groupsByClient = await loadRecordGroupsForClients(withPrismaDays);
  const withGroups = enrichClientsDaysFromRecordGroups(
    withPrismaDays,
    groupsByClient,
    refDay
  );

  if (maxApiFallback <= 0) {
    return withGroups;
  }

  // Як Direct: API лише якщо після KV днів немає.
  return enrichClientsMissingDaysFromAltegioApi(withGroups, refDay, maxApiFallback);
}
