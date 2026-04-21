// web/lib/direct-binotel-filter-counts.ts
// Глобальні лічильники фільтра «Дзвінки» (узгоджено з BinotelCallsFilterDropdown + route).

import { prisma } from '@/lib/prisma';

const SUCCESS_DISPOSITIONS = new Set(['ANSWER', 'VM-SUCCESS', 'SUCCESS']);

function normalizePhoneForCompare(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('38') && digits.length >= 11) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 9) return '38' + digits;
  return digits;
}

export type BinotelCallsFilterCounts = {
  incoming: number;
  outgoing: number;
  success: number;
  fail: number;
  onlyNew: number;
};

export type ComputeBinotelCallsFilterCountsOptions = {
  /**
   * YYYY-MM-DD (Europe/Kyiv) — клієнти, у яких був хоча б один дзвінок у цей календарний день;
   * напрямок/успіх рахуються по останньому дзвінку в межах цього дня (не по глобальному останньому).
   */
  kyivDay?: string | null;
};

export type BinotelLatestOnKyivDayRow = {
  callType: string;
  disposition: string;
};

/**
 * Для кожного клієнта — останній дзвінок у межах обраного календарного дня (Kyiv).
 * Потрібно для фільтра «дзвінки за день», коли пізніше був інший дзвінок (наприклад сьогодні).
 */
export async function fetchBinotelLatestCallPerClientOnKyivDay(
  kyivDay: string
): Promise<Map<string, BinotelLatestOnKyivDayRow>> {
  const valid = kyivDay.trim();
  const empty = new Map<string, BinotelLatestOnKyivDayRow>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valid)) return empty;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ clientId: string; callType: string; disposition: string }>
    >`
      WITH day_calls AS (
        SELECT "clientId", "callType", "disposition", "startTime"
        FROM "direct_client_binotel_calls"
        WHERE "clientId" IS NOT NULL
          AND to_char(("startTime" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') = ${valid}
      ),
      latest_on_day AS (
        SELECT DISTINCT ON ("clientId") "clientId", "callType", "disposition"
        FROM day_calls
        ORDER BY "clientId", "startTime" DESC
      )
      SELECT "clientId", "callType", "disposition" FROM latest_on_day
    `;
    const m = new Map<string, BinotelLatestOnKyivDayRow>();
    for (const r of rows) {
      if (r.clientId) {
        m.set(r.clientId, { callType: r.callType, disposition: r.disposition });
      }
    }
    return m;
  } catch (err) {
    console.warn(
      '[direct-binotel-filter-counts] fetchBinotelLatestCallPerClientOnKyivDay:',
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}

/**
 * Підрахунок по всій базі: останній дзвінок на клієнта з direct_client_binotel_calls,
 * умова «Нові» — як у clientMatchesBinotelFilter (унікальний телефон, binotel-lead, без Altegio).
 */
export async function computeBinotelCallsFilterCountsFromDb(
  options?: ComputeBinotelCallsFilterCountsOptions
): Promise<BinotelCallsFilterCounts> {
  const empty: BinotelCallsFilterCounts = { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 };
  const rawDay = options?.kyivDay?.trim();
  const validDay = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null;

  try {
    let latestRows: Array<{ clientId: string; callType: string; disposition: string }>;
    if (validDay) {
      latestRows = await prisma.$queryRaw<
        Array<{ clientId: string; callType: string; disposition: string }>
      >`
        WITH day_calls AS (
          SELECT "clientId", "callType", "disposition", "startTime"
          FROM "direct_client_binotel_calls"
          WHERE "clientId" IS NOT NULL
            AND to_char(("startTime" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') = ${validDay}
        ),
        latest_on_day AS (
          SELECT DISTINCT ON ("clientId") "clientId", "callType", "disposition"
          FROM day_calls
          ORDER BY "clientId", "startTime" DESC
        )
        SELECT "clientId", "callType", "disposition" FROM latest_on_day
      `;
    } else {
      latestRows = await prisma.$queryRaw<
        Array<{ clientId: string; callType: string; disposition: string }>
      >`
        SELECT DISTINCT ON ("clientId") "clientId", "callType", "disposition"
        FROM "direct_client_binotel_calls"
        WHERE "clientId" IS NOT NULL
        ORDER BY "clientId", "startTime" DESC
      `;
    }

    const [countsAgg, clientsMinimal] = await Promise.all([
      prisma.directClientBinotelCall.groupBy({
        by: ['clientId'],
        where: { clientId: { not: null } },
        _count: { id: true },
      }),
      prisma.directClient.findMany({
        select: { id: true, phone: true, state: true, altegioClientId: true },
      }),
    ]);

    const countByClient = new Map<string, number>();
    for (const r of countsAgg) {
      if (r.clientId) {
        countByClient.set(r.clientId, r._count.id);
      }
    }

    const latestMap = new Map<string, { callType: string; disposition: string }>();
    for (const row of latestRows) {
      if (row.clientId) {
        latestMap.set(row.clientId, { callType: row.callType, disposition: row.disposition });
      }
    }

    const phoneToClientIds = new Map<string, string[]>();
    for (const c of clientsMinimal) {
      const norm = normalizePhoneForCompare(c.phone);
      if (!norm) continue;
      const arr = phoneToClientIds.get(norm) ?? [];
      if (!arr.includes(c.id)) arr.push(c.id);
      phoneToClientIds.set(norm, arr);
    }

    const clientById = new Map(clientsMinimal.map((c) => [c.id, c]));

    let incoming = 0;
    let outgoing = 0;
    let success = 0;
    let fail = 0;
    let onlyNew = 0;

    for (const [clientId, cnt] of countByClient) {
      if (cnt <= 0) continue;
      const latest = latestMap.get(clientId);
      if (!latest) continue;

      const { callType, disposition } = latest;
      const isSuccess = SUCCESS_DISPOSITIONS.has(disposition);

      if (callType === 'incoming') incoming++;
      if (callType === 'outgoing') outgoing++;
      if (isSuccess) success++;
      else fail++;

      const c = clientById.get(clientId);
      if (!c) continue;
      if (c.state !== 'binotel-lead') continue;
      if (c.altegioClientId) continue;
      const phoneNorm = normalizePhoneForCompare(c.phone);
      if (!phoneNorm) continue;
      const idsWithSamePhone = phoneToClientIds.get(phoneNorm) ?? [];
      if (idsWithSamePhone.length !== 1 || idsWithSamePhone[0] !== c.id) continue;
      onlyNew++;
    }

    return { incoming, outgoing, success, fail, onlyNew };
  } catch (err) {
    console.warn(
      '[direct-binotel-filter-counts] computeBinotelCallsFilterCountsFromDb:',
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}
