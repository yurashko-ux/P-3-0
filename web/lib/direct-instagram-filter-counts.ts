// web/lib/direct-instagram-filter-counts.ts
// Швидкий підрахунок клієнтів з/без Instagram (SQL COUNT, без getAllDirectClients).

import { prisma } from '@/lib/prisma';
import type { InstInstagramPresenceCounts } from '@/lib/direct-instagram-presence-filter';

export type InstInstagramCounts = InstInstagramPresenceCounts;

/**
 * Підрахунок по direct_clients:
 * - hasClient: реальний IG + altegioClientId
 * - missingClient: без реального IG + altegioClientId
 * - hasLead: реальний IG без altegioClientId
 *
 * Умова «реальний IG» — як hasNormalInstagramUsername (inline, без Prisma-параметра в WHERE).
 */
export async function computeInstInstagramCountsFromDb(): Promise<InstInstagramCounts> {
  const rows = await prisma.$queryRaw<
    Array<{ hasClient: bigint; missingClient: bigint; hasLead: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE TRIM(COALESCE("instagramUsername", '')) <> ''
          AND "instagramUsername" <> 'NO INSTAGRAM'
          AND "instagramUsername" NOT LIKE 'no_instagram_%'
          AND "instagramUsername" NOT LIKE 'missing_instagram_%'
          AND "instagramUsername" NOT LIKE 'altegio_%'
          AND "instagramUsername" NOT LIKE 'binotel_%'
          AND "instagramUsername" NOT LIKE '__no_ig__%'
          AND "altegioClientId" IS NOT NULL
      )::bigint AS "hasClient",
      COUNT(*) FILTER (
        WHERE NOT (
          TRIM(COALESCE("instagramUsername", '')) <> ''
          AND "instagramUsername" <> 'NO INSTAGRAM'
          AND "instagramUsername" NOT LIKE 'no_instagram_%'
          AND "instagramUsername" NOT LIKE 'missing_instagram_%'
          AND "instagramUsername" NOT LIKE 'altegio_%'
          AND "instagramUsername" NOT LIKE 'binotel_%'
          AND "instagramUsername" NOT LIKE '__no_ig__%'
        )
          AND "altegioClientId" IS NOT NULL
      )::bigint AS "missingClient",
      COUNT(*) FILTER (
        WHERE TRIM(COALESCE("instagramUsername", '')) <> ''
          AND "instagramUsername" <> 'NO INSTAGRAM'
          AND "instagramUsername" NOT LIKE 'no_instagram_%'
          AND "instagramUsername" NOT LIKE 'missing_instagram_%'
          AND "instagramUsername" NOT LIKE 'altegio_%'
          AND "instagramUsername" NOT LIKE 'binotel_%'
          AND "instagramUsername" NOT LIKE '__no_ig__%'
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

/** Нормалізація відповіді API (новий формат + legacy has/missing). */
export function normalizeInstInstagramCountsFromApi(
  raw: Record<string, unknown> | null | undefined,
): InstInstagramPresenceCounts | null {
  if (raw == null || typeof raw !== 'object') return null;

  const hasClient = Number(raw.hasClient);
  const missingClient = Number(raw.missingClient);
  const hasLead = Number(raw.hasLead);
  if (
    Number.isFinite(hasClient) ||
    Number.isFinite(missingClient) ||
    Number.isFinite(hasLead)
  ) {
    return {
      hasClient: Number.isFinite(hasClient) ? hasClient : 0,
      missingClient: Number.isFinite(missingClient) ? missingClient : 0,
      hasLead: Number.isFinite(hasLead) ? hasLead : 0,
    };
  }

  const legacyHas = Number(raw.has);
  const legacyMissing = Number(raw.missing);
  if (Number.isFinite(legacyHas) || Number.isFinite(legacyMissing)) {
    return {
      hasClient: Number.isFinite(legacyHas) ? legacyHas : 0,
      missingClient: Number.isFinite(legacyMissing) ? legacyMissing : 0,
      hasLead: 0,
    };
  }

  return null;
}

export function instInstagramCountsSum(c: InstInstagramPresenceCounts): number {
  return c.hasClient + c.missingClient + c.hasLead;
}
