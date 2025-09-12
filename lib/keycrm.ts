// lib/keycrm.ts (ROOT) — KeyCRM adapter + KV-based search (без kvZRevRange)

import { kvGet, kvZRange } from '@/lib/kv';

/* ============ HTTP базовий клієнт ============ */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const BASE_URL = (process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1').replace(/\/+$/, '');
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

function qs(params: Record<string, any> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function keycrmFetch<T = any>(
  path: string,
  opts: { method?: HttpMethod; query?: Record<string, any>; body?: any; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: any }> {
  const { method = 'GET', query, body, timeoutMs = 10000 } = opts;
  const url = `${BASE_URL}/${path.replace(/^\/+/, '')}${qs(query)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(t);

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }
    if (!res.ok) return { ok: false, status: res.status, data, error: data };
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(t);
    return { ok: false, status: 0, data: null, error: err };
  }
}

/* ============ Публічні HTTP-ендпойнти ============ */

export async function kcGetPipelines() {
  return keycrmFetch<any[]>('/pipelines');
}

export async function kcGetStatuses(pipelineId: string | number) {
  // деякі акаунти мають різні роути — страхуємо
  const a = await keycrmFetch<any[]>(`/pipelines/${pipelineId}/statuses`);
  if (a.ok) return a;
  return keycrmFetch<any[]>('/pipelines/statuses', { query: { pipeline_id: pipelineId } });
}

export interface ListCardsParams {
  pipeline_id: string | number;
  status_id: string | number;
  page?: number;
  per_page?: number;
}

export async function kcListCardsLaravel(params: ListCardsParams) {
  const { pipeline_id, status_id, page = 1, per_page = 50 } = params;
  const r = await keycrmFetch<any>('/pipelines/cards', {
    method: 'GET',
    query: { pipeline_id, status_id, page, per_page },
  });
  // повертаємо data у максимально «пласкій» формі для зручності
  const d = (r.data as any) || {};
  return {
    ok: r.ok,
    status: r.status,
    data: d.data ?? d.items ?? [],
    current_page: d.current_page ?? d.meta?.current_page ?? page,
    last_page: d.last_page ?? d.meta?.last_page ?? page,
    per_page: d.per_page ?? d.meta?.per_page ?? per_page,
    raw: r.data,
  };
}

export async function kcMoveCard(
  cardId: string | number,
  to_pipeline_id?: string | number | null,
  to_status_id?: string | number | null,
) {
  const body: Record<string, any> = {};
  if (to_pipeline_id != null && to_pipeline_id !== '') body.pipeline_id = Number(to_pipeline_id);
  if (to_status_id != null && to_status_id !== '') body.status_id = Number(to_status_id);
  if (!Object.keys(body).length) return { ok: true, status: 200, data: { noop: true } };
  return keycrmFetch(`/pipelines/cards/${cardId}`, { method: 'PUT', body });
}

/* ============ Нормалізація картки ============ */

export type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string;
};

export function normalizeCard(raw: any): NormalizedCard {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? '').toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName = raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? '').trim(),
    pipeline_id: pipelineId != null ? Number(pipelineId) : null,
    status_id: statusId != null ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  };
}

export function toEpoch(x?: string | number | Date | null): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : Date.now();
  }
  return Date.now();
}

/* ============ KV утиліти пошуку ============ */

// Емуляція ZREVRANGE через kvZRange + reverse
async function zRevRange(key: string, start: number, stop: number): Promise<string[]> {
  const raw = (await kvZRange(key, 0, -1)) as any;
  const all: string[] = extractMembers(raw).reverse();
  const end = stop < 0 ? all.length + stop + 1 : stop + 1; // inclusive
  return all.slice(start, end);
}

function extractMembers(arr: any): string[] {
  if (!arr) return [];
  if (Array.isArray(arr)) {
    return arr.map((x: any) => (typeof x === 'string' ? x : x?.member)).filter(Boolean);
  }
  return [];
}

function normHandle(raw?: string | null): string | null {
  if (!raw) return null;
  return String(raw).trim().replace(/^@/, '').toLowerCase();
}

function includesCI(h?: string | null, n?: string | null): boolean {
  if (!h || !n) return false;
  return h.toLowerCase().includes(n.toLowerCase());
}

type KvCard = {
  id: number;
  title?: string | null;
  pipeline_id?: number | null;
  status_id?: number | null;
  contact_social_name?: string | null;
  contact_social_id?: string | null;
  contact_full_name?: string | null;
  updated_at?: string | null;
};

async function getKvCard(id: string): Promise<KvCard | null> {
  const raw = await kvGet(`kc:card:${id}`);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as KvCard) : (raw as KvCard);
  } catch {
    return null;
  }
}

function inBasePair(card: KvCard, p?: string, s?: string): boolean {
  if (!p || !s) return true; // без фільтра — приймаємо будь-яку пару
  const cp = card.pipeline_id != null ? String(card.pipeline_id) : '';
  const cs = card.status_id != null ? String(card.status_id) : '';
  return cp === p && cs === s;
}

/* ============ Пошук по username з оверлоадами ============ */

// Overloads для TS: рядок або об’єкт
export function findCardIdByUsername(username: string): Promise<string | null>;
export function findCardIdByUsername(args: {
  username: string;
  pipeline_id?: string | number;
  status_id?: string | number;
  limit?: number;
}): Promise<string | null>;

export async function findCardIdByUsername(arg: any): Promise<string | null> {
  const username = typeof arg === 'string' ? arg : arg?.username;
  const p = typeof arg === 'string' ? undefined : arg?.pipeline_id != null ? String(arg.pipeline_id) : undefined;
  const s = typeof arg === 'string' ? undefined : arg?.status_id != null ? String(arg.status_id) : undefined;
  const limit = typeof arg === 'string' ? 50 : arg?.limit ?? 50;

  const h = normHandle(username);
  if (!h) return null;

  const keyA = `kc:index:social:instagram:${h}`;
  const keyB = `kc:index:social:instagram:@${h}`;

  const a = await zRevRange(keyA, 0, Math.max(1, limit) - 1);
  const b = await zRevRange(keyB, 0, Math.max(1, limit) - 1);
  const mergedIds = [...new Set([...a, ...b])];

  let best: { id: string; score: number } | null = null;
  for (const id of mergedIds) {
    const card = await getKvCard(id);
    if (!card) continue;
    if (!inBasePair(card, p, s)) continue;
    const score = toEpoch(card.updated_at);
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/* ============ Пошук по будь-яких ManyChat-полях ============ */

export async function kcFindCardIdByAny(args: {
  username?: string | null;
  full_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pipeline_id?: string | number;
  status_id?: string | number;
  limit?: number;
}): Promise<string | null> {
  const {
    username,
    full_name,
    name,
    first_name,
    last_name,
    pipeline_id,
    status_id,
    limit = 200,
  } = args;

  // 1) username (IG) — пріоритет
  if (username) {
    const byUser = await findCardIdByUsername({
      username,
      pipeline_id,
      status_id,
      limit: 50,
    });
    if (byUser) return byUser;
  }

  // 2) Імена / титул
  const candidates = new Set<string>();
  if (full_name) candidates.add(String(full_name).trim());
  if (name) candidates.add(String(name).trim());
  if (first_name || last_name) candidates.add(`${first_name ?? ''} ${last_name ?? ''}`.trim());
  for (const v of [...candidates]) if (!v) candidates.delete(v);
  if (candidates.size === 0) return null;

  // будуємо список ключів пар (за наявності — точна пара)
  const keysToScan: string[] = [];
  if (pipeline_id != null && status_id != null) {
    keysToScan.push(`kc:index:cards:${String(pipeline_id)}:${String(status_id)}`);
  } else {
    // якщо базова пара не задана — можна обмежено просканувати декілька найбільш уживаних
    for (let p = 1; p <= 5; p++) {
      for (let s = 1; s <= 10; s++) {
        keysToScan.push(`kc:index:cards:${p}:${s}`);
      }
    }
  }

  for (const cardsKey of keysToScan) {
    const ids = await zRevRange(cardsKey, 0, Math.max(1, limit) - 1);
    for (const id of ids) {
      const card = await getKvCard(id);
      if (!card) continue;

      if (pipeline_id != null && status_id != null && !inBasePair(card, String(pipeline_id), String(status_id))) {
        continue;
      }

      const title = card.title ?? '';
      const cfn = card.contact_full_name ?? '';

      for (const q of candidates) {
        if (includesCI(title, q) || includesCI(cfn, q) || includesCI(title, `Чат з ${q}`)) {
          return String(card.id);
        }
      }
    }
  }

  return null;
}
