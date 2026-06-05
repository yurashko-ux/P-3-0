// Фільтр «є Instagram» для неактивної бази.

import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';

export type InstInstagramFilterValue = 'has' | 'missing';

export type InstInstagramCounts = { has: number; missing: number };

export function parseInstInstagramFilter(raw: string | null): InstInstagramFilterValue[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is InstInstagramFilterValue => x === 'has' || x === 'missing');
}

export function clientHasInstagram(client: { instagramUsername?: string | null }): boolean {
  return hasNormalInstagramUsername(client.instagramUsername);
}

export function computeInstInstagramCounts<T extends { instagramUsername?: string | null }>(
  clients: T[]
): InstInstagramCounts {
  let has = 0;
  for (const c of clients) {
    if (clientHasInstagram(c)) has++;
  }
  return { has, missing: clients.length - has };
}

export function filterByInstInstagram<T extends { instagramUsername?: string | null }>(
  clients: T[],
  values: InstInstagramFilterValue[]
): T[] {
  if (!values.length) return clients;
  const set = new Set(values);
  return clients.filter((c) => {
    const has = clientHasInstagram(c);
    return (has && set.has('has')) || (!has && set.has('missing'));
  });
}
