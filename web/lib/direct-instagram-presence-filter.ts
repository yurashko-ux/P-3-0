// web/lib/direct-instagram-presence-filter.ts
// Фільтр Instagram у колонці Inst (Direct): клієнт vs лід (altegioClientId).

import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';

export type InstInstagramFilterValue = 'hasClient' | 'missingClient' | 'hasLead';

export const INSTAGRAM_PRESENCE_FILTER_OPTIONS: ReadonlyArray<{
  id: InstInstagramFilterValue;
  label: string;
}> = [
  { id: 'hasClient', label: 'Є Instagram (клієнт)' },
  { id: 'missingClient', label: 'Немає Instagram (клієнт)' },
  { id: 'hasLead', label: 'Є Instagram (Лід)' },
];

export type InstInstagramPresenceCounts = {
  hasClient: number;
  missingClient: number;
  hasLead: number;
};

const VALID = new Set<string>(['hasClient', 'missingClient', 'hasLead']);

export function parseInstInstagramFilterParam(raw: string | null): InstInstagramFilterValue[] {
  if (!raw?.trim()) return [];
  const out: InstInstagramFilterValue[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (v === 'hasClient' || v === 'missingClient' || v === 'hasLead') {
      out.push(v);
      continue;
    }
    // Сумісність зі старими URL: has / missing
    if (v === 'has') {
      out.push('hasClient', 'hasLead');
    } else if (v === 'missing') {
      out.push('missingClient');
    }
  }
  return [...new Set(out)];
}

export function isInstInstagramFilterValue(v: string): v is InstInstagramFilterValue {
  return VALID.has(v);
}

export function matchesInstInstagramFilter(
  client: { instagramUsername?: string | null; altegioClientId?: number | null },
  values: InstInstagramFilterValue[],
): boolean {
  if (values.length === 0) return true;
  const hasIg = hasNormalInstagramUsername(client.instagramUsername);
  const isClient = client.altegioClientId != null && Number(client.altegioClientId) > 0;
  const set = new Set(values);
  return (
    (hasIg && isClient && set.has('hasClient')) ||
    (!hasIg && isClient && set.has('missingClient')) ||
    (hasIg && !isClient && set.has('hasLead'))
  );
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
