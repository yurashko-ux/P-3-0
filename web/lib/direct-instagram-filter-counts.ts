// web/lib/direct-instagram-filter-counts.ts
// Швидкий підрахунок клієнтів з/без Instagram (SQL COUNT, без getAllDirectClients).

import { prisma } from '@/lib/prisma';

export type InstInstagramCounts = { has: number; missing: number };

/**
 * Підрахунок по всій direct_clients одним SQL-запитом.
 * Логіка «є Instagram» — як hasNormalInstagramUsername у client-utils.
 * has + missing = total рядків у таблиці.
 */
export async function computeInstInstagramCountsFromDb(): Promise<InstInstagramCounts> {
  const rows = await prisma.$queryRaw<Array<{ has: bigint; missing: bigint }>>`
    SELECT
      COUNT(*) FILTER (
        WHERE TRIM(COALESCE("instagramUsername", '')) <> ''
          AND "instagramUsername" <> 'NO INSTAGRAM'
          AND "instagramUsername" NOT LIKE 'no_instagram_%'
          AND "instagramUsername" NOT LIKE 'missing_instagram_%'
          AND "instagramUsername" NOT LIKE 'altegio_%'
          AND "instagramUsername" NOT LIKE 'binotel_%'
      )::bigint AS has,
      COUNT(*) FILTER (
        WHERE TRIM(COALESCE("instagramUsername", '')) = ''
          OR "instagramUsername" = 'NO INSTAGRAM'
          OR "instagramUsername" LIKE 'no_instagram_%'
          OR "instagramUsername" LIKE 'missing_instagram_%'
          OR "instagramUsername" LIKE 'altegio_%'
          OR "instagramUsername" LIKE 'binotel_%'
      )::bigint AS missing
    FROM "direct_clients"
  `;
  return {
    has: Number(rows[0]?.has ?? 0),
    missing: Number(rows[0]?.missing ?? 0),
  };
}
