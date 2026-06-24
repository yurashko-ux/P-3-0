// web/lib/direct-instagram-filter-counts.ts
// Швидкий підрахунок клієнтів з/без Instagram (SQL COUNT, без getAllDirectClients).

import { prisma } from '@/lib/prisma';
import type { InstInstagramPresenceCounts } from '@/lib/direct-instagram-presence-filter';
import { REAL_INSTAGRAM_USERNAME_SQL } from '@/lib/direct-instagram-presence-filter';

export type InstInstagramCounts = InstInstagramPresenceCounts;

/**
 * Підрахунок по direct_clients:
 * - hasClient: реальний IG + altegioClientId
 * - missingClient: без реального IG + altegioClientId
 * - hasLead: реальний IG без altegioClientId
 */
export async function computeInstInstagramCountsFromDb(): Promise<InstInstagramCounts> {
  const rows = await prisma.$queryRaw<
    Array<{ hasClient: bigint; missingClient: bigint; hasLead: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE (${REAL_INSTAGRAM_USERNAME_SQL})
          AND "altegioClientId" IS NOT NULL
      )::bigint AS "hasClient",
      COUNT(*) FILTER (
        WHERE NOT (${REAL_INSTAGRAM_USERNAME_SQL})
          AND "altegioClientId" IS NOT NULL
      )::bigint AS "missingClient",
      COUNT(*) FILTER (
        WHERE (${REAL_INSTAGRAM_USERNAME_SQL})
          AND "altegioClientId" IS NULL
      )::bigint AS "hasLead"
    FROM "direct_clients"
  `;
  return {
    hasClient: Number(rows[0]?.hasClient ?? 0),
    missingClient: Number(rows[0]?.missingClient ?? 0),
    hasLead: Number(rows[0]?.hasLead ?? 0),
  };
}
