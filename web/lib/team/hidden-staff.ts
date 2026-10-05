// Хто прихований у Команді. Журнал і онлайн-запис беруть штат з Altegio,
// тому збіг: altegioStaffId, потім directMasterId, потім імʼя.

import { prisma } from "@/lib/prisma";

export type HiddenStaffIndex = {
  altegioStaffIds: Set<number>;
  directMasterIds: Set<string>;
  /** Повне імʼя після нормалізації. */
  nameKeys: Set<string>;
  /** Перший токен лише якщо в видимих людей такого імені немає (щоб не сховати другу «Вікторію»). */
  exclusiveFirstTokens: Set<string>;
};

const EMPTY: HiddenStaffIndex = {
  altegioStaffIds: new Set(),
  directMasterIds: new Set(),
  nameKeys: new Set(),
  exclusiveFirstTokens: new Set(),
};

export function normalizePersonName(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .replace(/\s+/g, " ");
}

function firstToken(name: string): string {
  return normalizePersonName(name).split(" ")[0] || "";
}

export async function loadHiddenStaffIndex(): Promise<HiddenStaffIndex> {
  const rows = await prisma.teamMember.findMany({
    select: { name: true, altegioStaffId: true, directMasterId: true, hiddenAt: true },
  });
  const hidden = rows.filter((row) => row.hiddenAt != null);
  if (hidden.length === 0) return EMPTY;

  const visibleFirst = new Set<string>();
  for (const row of rows) {
    if (row.hiddenAt != null) continue;
    const token = firstToken(row.name);
    if (token) visibleFirst.add(token);
  }

  const index: HiddenStaffIndex = {
    altegioStaffIds: new Set(),
    directMasterIds: new Set(),
    nameKeys: new Set(),
    exclusiveFirstTokens: new Set(),
  };
  for (const row of hidden) {
    if (row.altegioStaffId != null && row.altegioStaffId > 0) {
      index.altegioStaffIds.add(row.altegioStaffId);
    }
    if (row.directMasterId) index.directMasterIds.add(row.directMasterId);
    const key = normalizePersonName(row.name);
    if (key) index.nameKeys.add(key);
    const token = firstToken(row.name);
    if (token && !visibleFirst.has(token)) index.exclusiveFirstTokens.add(token);
  }
  return index;
}

export function labelMatchesHidden(index: HiddenStaffIndex, label: string | null | undefined): boolean {
  const key = normalizePersonName(label);
  if (!key) return false;
  if (index.nameKeys.has(key)) return true;
  const token = key.split(" ")[0] || "";
  return Boolean(token && index.exclusiveFirstTokens.has(token));
}

export function isHiddenJournalStaff(
  index: HiddenStaffIndex,
  staff: { altegioStaffId?: number | null; name?: string | null },
): boolean {
  const id = Number(staff.altegioStaffId);
  if (Number.isFinite(id) && id > 0 && index.altegioStaffIds.has(id)) return true;
  return labelMatchesHidden(index, staff.name);
}

export function isHiddenDirectMaster(
  index: HiddenStaffIndex,
  master: { id?: string | null; name?: string | null; altegioStaffId?: number | null },
): boolean {
  if (master.id && index.directMasterIds.has(master.id)) return true;
  const staffId = Number(master.altegioStaffId);
  if (Number.isFinite(staffId) && staffId > 0 && index.altegioStaffIds.has(staffId)) return true;
  return labelMatchesHidden(index, master.name);
}

/** Рядок деталізації ЗП: ключ master:{altegioStaffId} або підпис. */
export function isHiddenExpenseRow(
  index: HiddenStaffIndex,
  row: { key: string; label: string },
): boolean {
  const match = /^master:(\d+)$/.exec(row.key);
  if (match && index.altegioStaffIds.has(Number(match[1]))) return true;
  return labelMatchesHidden(index, row.label);
}

export function omitHiddenLabels<T extends { name: string }>(rows: T[], index: HiddenStaffIndex): T[] {
  return rows.filter((row) => !labelMatchesHidden(index, row.name));
}

/** Прибирає прихованих з опцій фільтра «Майстер» (перший токен імені). */
export async function stripHiddenFromMasterPanels<
  P extends { primaryNames: Array<{ name: string }>; secondaryNames: Array<{ name: string }> },
  C extends { name: string },
>(panel: P, consult: C[]): Promise<{ panel: P; consult: C[] }> {
  const index = await loadHiddenStaffIndex();
  return {
    panel: {
      ...panel,
      primaryNames: omitHiddenLabels(panel.primaryNames, index),
      secondaryNames: omitHiddenLabels(panel.secondaryNames, index),
    },
    consult: omitHiddenLabels(consult, index),
  };
}
