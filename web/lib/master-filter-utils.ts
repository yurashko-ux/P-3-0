// web/lib/master-filter-utils.ts
// Спільна логіка фільтра «Майстер» (руки + перші токени імен) для UI та API.

import type { DirectClient } from '@/lib/direct-types';

/** Повертає перший токен (ім'я) з рядка, без прізвища. */
export function firstToken(name: string | null | undefined): string {
  if (name == null) return '';
  const t = (name || '').toString().trim();
  const part = t.split(/\s+/)[0] || '';
  return part.trim();
}

/**
 * Множина дозволених імен (перших токенів) з списку відповідальних (DirectMaster).
 */
export function getAllowedFirstNames(masters: { id: string; name: string }[]): Set<string> {
  const set = new Set<string>();
  for (const m of masters) {
    const first = firstToken(m.name);
    if (first) set.add(first);
  }
  return set;
}

/**
 * Групує рядки імен по firstToken і рахує суму; залишає лише ті імена, що в allowedFirstNames.
 */
export function groupByFirstTokenAndFilter(
  rawNames: (string | null | undefined)[],
  allowedFirstNames: Set<string>
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const raw of rawNames) {
    const n = (raw || '').toString().trim();
    if (!n) continue;
    const first = firstToken(n);
    if (!first || !allowedFirstNames.has(first)) continue;
    map.set(first, (map.get(first) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type GlobalMasterFilterPanelCounts = {
  handsCounts: Record<'2' | '4' | '6', number>;
  primaryNames: Array<{ name: string; count: number }>;
  secondaryNames: Array<{ name: string; count: number }>;
};

/**
 * Глобальні лічильники панелі «Майстер» (вся база), узгоджено з MasterFilterDropdown.
 */
export function buildGlobalMasterFilterPanelCounts(
  clients: DirectClient[],
  masters: { id: string; name: string }[]
): GlobalMasterFilterPanelCounts {
  const handsCounts: Record<'2' | '4' | '6', number> = { '2': 0, '4': 0, '6': 0 };
  const primaryRawNames: string[] = [];
  const secondaryRawNames: string[] = [];

  for (const c of clients) {
    const ph = (c as { paidServiceHands?: unknown }).paidServiceHands;
    if (ph === 2 || ph === 4 || ph === 6) {
      handsCounts[String(ph) as '2' | '4' | '6']++;
    }
    const n = (c.serviceMasterName || '').toString().trim();
    if (n) primaryRawNames.push(n);
    const mid = c.masterId;
    if (mid) {
      const mn = masters.find((x) => x.id === mid)?.name?.trim();
      if (mn) primaryRawNames.push(mn);
    }
    secondaryRawNames.push(((c as { serviceSecondaryMasterName?: string }).serviceSecondaryMasterName || '').toString().trim());
  }

  const allowed = getAllowedFirstNames(masters);
  return {
    handsCounts,
    primaryNames: groupByFirstTokenAndFilter(primaryRawNames, allowed),
    secondaryNames: groupByFirstTokenAndFilter(secondaryRawNames, allowed),
  };
}
