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

/** Групує всі імена по першому токену (без обмеження реєстром DirectMaster). */
export function groupByFirstToken(
  rawNames: (string | null | undefined)[]
): Array<{ name: string; count: number }> {
  const map = new Map<string, { name: string; count: number }>();
  for (const raw of rawNames) {
    const n = (raw || '').toString().trim();
    if (!n) continue;
    const first = firstToken(n);
    if (!first) continue;
    const key = first.toLowerCase();
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { name: first, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Додає майстрів з реєстру DirectMaster, яких ще немає в даних (count=0). */
export function mergeMasterOptionsWithRegistry(
  fromData: Array<{ name: string; count: number }>,
  masters: { id: string; name: string }[]
): Array<{ name: string; count: number }> {
  const map = new Map<string, { name: string; count: number }>();
  for (const item of fromData) {
    map.set(item.name.toLowerCase(), item);
  }
  for (const m of masters) {
    const first = firstToken(m.name);
    if (!first) continue;
    const key = first.toLowerCase();
    if (!map.has(key)) map.set(key, { name: first, count: 0 });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Сирі імена майстрів запису з полів клієнта (для підрахунку у фільтрі). */
export function getRecordMasterRawNames(client: DirectClient): string[] {
  const names: string[] = [];
  const full = (client.serviceMasterName || '').toString().trim();
  if (full) names.push(full);
  const secondary = ((client as { serviceSecondaryMasterName?: string }).serviceSecondaryMasterName || '')
    .toString()
    .trim();
  if (secondary) names.push(secondary);
  const breakdown = (client as { paidServiceVisitBreakdown?: { masterName?: string }[] }).paidServiceVisitBreakdown;
  if (Array.isArray(breakdown)) {
    for (const b of breakdown) {
      const n = (b.masterName || '').toString().trim();
      if (n) names.push(n);
    }
  }
  return names;
}

export type GlobalMasterFilterPanelCounts = {
  handsCounts: Record<'2' | '4' | '6', number>;
  /** Усі майстри з колонки «Майстер запису» (головний, додатковий, breakdown). */
  primaryNames: Array<{ name: string; count: number }>;
  /** @deprecated Лишено для сумісності; UI використовує primaryNames. */
  secondaryNames: Array<{ name: string; count: number }>;
};

/** Перші токени імен майстрів платного запису (узгоджено з колонкою «Майстер запису»). */
export function getRecordMasterFirstTokens(client: DirectClient): string[] {
  const tokens = new Set<string>();
  const full = (client.serviceMasterName || '').toString().trim();
  if (full) {
    const t = firstToken(full).toLowerCase().trim();
    if (t) tokens.add(t);
  }
  const secondary = ((client as { serviceSecondaryMasterName?: string }).serviceSecondaryMasterName || '')
    .toString()
    .trim();
  if (secondary) {
    const t = firstToken(secondary).toLowerCase().trim();
    if (t) tokens.add(t);
  }
  const breakdown = (client as { paidServiceVisitBreakdown?: { masterName?: string }[] }).paidServiceVisitBreakdown;
  if (Array.isArray(breakdown)) {
    for (const b of breakdown) {
      const n = (b.masterName || '').toString().trim();
      if (!n) continue;
      const t = firstToken(n).toLowerCase().trim();
      if (t) tokens.add(t);
    }
  }
  return [...tokens];
}

/** Клієнт має хоча б одного майстра запису з обраного списку (перший токен імені). */
export function clientMatchesRecordMasterFilter(
  client: DirectClient,
  selectedFirstNamesLower: Set<string>
): boolean {
  if (selectedFirstNamesLower.size === 0) return true;
  const tokens = getRecordMasterFirstTokens(client);
  return tokens.some((t) => selectedFirstNamesLower.has(t));
}

/** Клієнт має майстра консультації з обраного списку (перший токен імені). */
export function clientMatchesConsultMasterFilter(
  client: DirectClient,
  selectedFirstNamesLower: Set<string>
): boolean {
  if (selectedFirstNamesLower.size === 0) return true;
  const first = firstToken(client.consultationMasterName).toLowerCase().trim();
  return Boolean(first && selectedFirstNamesLower.has(first));
}

export function buildConsultMasterFilterPanelCounts(
  clients: DirectClient[],
  masters: { id: string; name: string }[]
): Array<{ name: string; count: number }> {
  return mergeMasterOptionsWithRegistry(
    groupByFirstToken(clients.map((c) => c.consultationMasterName)),
    masters
  );
}

/** Порожня панель майстра, коли skipPanelCounts=1 (окремий запит доповнить). */
export function emptyGlobalMasterFilterPanelCounts(): GlobalMasterFilterPanelCounts {
  return {
    handsCounts: { '2': 0, '4': 0, '6': 0 },
    primaryNames: [],
    secondaryNames: [],
  };
}

/**
 * Глобальні лічильники панелі «Майстер» (вся база), узгоджено з MasterFilterDropdown.
 */
export function buildGlobalMasterFilterPanelCounts(
  clients: DirectClient[],
  masters: { id: string; name: string }[]
): GlobalMasterFilterPanelCounts {
  const handsCounts: Record<'2' | '4' | '6', number> = { '2': 0, '4': 0, '6': 0 };
  const recordRawNames: string[] = [];

  for (const c of clients) {
    const ph = (c as { paidServiceHands?: unknown }).paidServiceHands;
    if (ph === 2 || ph === 4 || ph === 6) {
      handsCounts[String(ph) as '2' | '4' | '6']++;
    }
    recordRawNames.push(...getRecordMasterRawNames(c));
  }

  const primaryNames = mergeMasterOptionsWithRegistry(groupByFirstToken(recordRawNames), masters);

  return {
    handsCounts,
    primaryNames,
    secondaryNames: [],
  };
}
