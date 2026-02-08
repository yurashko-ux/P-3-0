// web/lib/direct-last-visit-updates.ts
// Оновлення lastVisitAt з вебхука — публікуємо в KV для оновлення UI без перезавантаження сторінки.

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { kvRead, kvWrite } from '@/lib/kv';

const KV_KEY = 'direct:last-visit-updates';
const MAX_ENTRIES = 100;

function toDayIndex(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return NaN;
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

/** Обчислює днів з останнього візиту (Europe/Kyiv), як у API clients. */
export function computeDaysSinceLastVisit(lastVisitAtIso: string): number | undefined {
  const iso = (lastVisitAtIso || '').toString().trim();
  if (!iso) return undefined;
  const day = kyivDayFromISO(iso);
  const idx = toDayIndex(day);
  if (!Number.isFinite(idx)) return undefined;
  const todayKyivDay = kyivDayFromISO(new Date().toISOString());
  const todayIdx = toDayIndex(todayKyivDay);
  if (!Number.isFinite(todayIdx)) return undefined;
  const diff = todayIdx - idx;
  return diff < 0 ? 0 : diff;
}

export type LastVisitAtUpdate = {
  clientId: string;
  lastVisitAt: string;
  daysSinceLastVisit: number | undefined;
  at: string;
};

/** Додати оновлення в чергу (викликати з вебхука після збереження lastVisitAt). */
export async function pushLastVisitAtUpdate(clientId: string, lastVisitAt: string): Promise<void> {
  const daysSinceLastVisit = computeDaysSinceLastVisit(lastVisitAt);
  const entry: LastVisitAtUpdate = {
    clientId,
    lastVisitAt,
    daysSinceLastVisit,
    at: new Date().toISOString(),
  };
  try {
    const raw = await kvRead.getRaw(KV_KEY);
    const list: LastVisitAtUpdate[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    const trimmed = list.slice(-MAX_ENTRIES);
    await kvWrite.setRaw(KV_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[direct-last-visit-updates] Не вдалося записати оновлення в KV (не критично):', err);
  }
}

/** Отримати оновлення після вказаного часу (для опитування з UI). */
export async function getLastVisitAtUpdates(since: string): Promise<LastVisitAtUpdate[]> {
  try {
    const raw = await kvRead.getRaw(KV_KEY);
    const list: LastVisitAtUpdate[] = raw ? JSON.parse(raw) : [];
    return list.filter((e) => e.at > since);
  } catch {
    return [];
  }
}
