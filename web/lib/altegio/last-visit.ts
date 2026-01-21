// web/lib/altegio/last-visit.ts
// Отримання дати останнього візиту клієнта (пакетно через clients/search)

import { getClientsPaginated } from './clients-search';
import type { Client } from './types';

function pickLastVisitISO(c: Client): string | null {
  const raw =
    (c as any)?.last_visit_date ??
    (c as any)?.lastVisitDate ??
    (c as any)?.last_visit_datetime ??
    (c as any)?.lastVisitAt;

  const s = raw ? String(raw).trim() : '';
  if (!s) return null;

  // Altegio часто віддає last_visit_date як "YYYY-MM-DD HH:mm:ss" (без таймзони).
  // Для задачі “днів з останнього візиту” нам критична саме ДАТА по Києву, не точний час.
  // Тому беремо YYYY-MM-DD і зберігаємо як ISO з “полуднем” (щоб уникнути зсувів при DST/UTC).
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m?.[1]) {
    return `${m[1]}T12:00:00.000Z`;
  }

  // Fallback: якщо прийшов інший формат, пробуємо стандартний парсинг.
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function fetchAltegioLastVisitMap(params: {
  companyId: number;
  pageSize?: number;
  maxPages?: number;
  maxClients?: number;
  delayMs?: number;
}): Promise<Map<number, string>> {
  const pageSize = Math.max(10, Math.min(200, params.pageSize ?? 100));
  const maxPages = Math.max(1, Math.min(500, params.maxPages ?? 200));
  const maxClients = Math.max(0, Math.min(100_000, params.maxClients ?? 0));
  const delayMs = Math.max(0, Math.min(2000, params.delayMs ?? 150));

  console.log('[altegio/last-visit] Старт: витягуємо last_visit_date через clients/search', {
    companyId: params.companyId,
    pageSize,
    maxPages,
    maxClients,
    delayMs,
  });

  const map = new Map<number, string>();
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const { clients, hasMore } = await getClientsPaginated(params.companyId, page, pageSize);
    pagesFetched++;

    if (!clients || clients.length === 0) break;

    for (const c of clients) {
      const id = Number((c as any)?.id);
      if (!id || Number.isNaN(id)) continue;
      const iso = pickLastVisitISO(c);
      if (!iso) continue;
      // Якщо дублі — беремо найновіший
      const prev = map.get(id);
      if (!prev || new Date(iso).getTime() > new Date(prev).getTime()) {
        map.set(id, iso);
      }
      if (maxClients && map.size >= maxClients) break;
    }

    console.log('[altegio/last-visit] Сторінка', {
      page,
      got: clients.length,
      pagesFetched,
      mapSize: map.size,
      hasMore,
    });

    if (maxClients && map.size >= maxClients) break;
    if (!hasMore) break;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log('[altegio/last-visit] Готово', { pagesFetched, mapSize: map.size });
  return map;
}

