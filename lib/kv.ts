// /lib/kv.ts
import type { RequestInit } from 'next/dist/server/web/spec-extension/request';

type KvOk<T> = { ok: true; data: T };
type KvErr = { ok: false; error: string };

const REST_URL =
  process.env.KV_REST_API_URL || process.env.KV_URL || '';
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.KV_REST_TOKEN || '';

if (!REST_URL || !REST_TOKEN) {
  console.warn('[KV] KV_REST_API_URL/KV_URL або KV_REST_API_TOKEN/KV_REST_TOKEN не задані.');
}

async function kvFetch<T>(
  path: string,
  init: RequestInit & { method?: 'GET' | 'POST' } = {}
): Promise<KvOk<T> | KvErr> {
  try {
    const res = await fetch(`${REST_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${REST_TOKEN}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      cache: 'no-store',
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `[KV ${res.status}] ${text}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ------- Збереження кампаній у KV -------
// Список id:        cmp:ids  (list)
// Окремий запис:    cmp:item:<id>  (json)

export async function kvPushId(id: string) {
  return kvFetch<number>('/lpush/cmp:ids', {
    method: 'POST',
    body: JSON.stringify({ value: id }),
  });
}

export async function kvListIds(): Promise<string[]> {
  const out = await kvFetch<string[]>('/lrange/cmp:ids/0/-1');
  if (!out.ok) return [];
  return out.data || [];
}

export async function kvDelIdFromList(id: string) {
  return kvFetch<number>('/lrem/cmp:ids/0', {
    method: 'POST',
    body: JSON.stringify({ value: id }),
  });
}

export async function kvSetItem(id: string, value: any) {
  return kvFetch<'OK'>(`/set/cmp:item:${id}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

export async function kvGetItem<T = any>(id: string): Promise<T | null> {
  const out = await kvFetch<T>(`/get/cmp:item:${id}`);
  if (!out.ok) return null;
  return out.data ?? null;
}

export async function kvDelItem(id: string) {
  return kvFetch<number>(`/del/cmp:item:${id}`, { method: 'POST' });
}

// DEBUG: SCAN keys
export async function kvScan(pattern: string = '*', count = 100) {
  const out = await kvFetch<{ cursor: number; keys: string[] }>(
    `/scan/0?pattern=${encodeURIComponent(pattern)}&count=${count}`
  );
  if (!out.ok) return { cursor: 0, keys: [] as string[] };
  return out.data;
}
