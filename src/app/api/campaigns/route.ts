// src/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

type Campaign = {
  id: string;
  created_at: string;
  from_pipeline_id: string;
  from_status_id: string;
  to_pipeline_id: string;
  to_status_id: string;
  expires_at?: string | null;
  note?: string | null;
  enabled: boolean;
};

const INDEX_KEY = 'campaigns:index';
const ITEM = (id: string) => `campaigns:${id}`;

function envOrDie(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const url = envOrDie('KV_REST_API_URL');
  const token = envOrDie('KV_REST_API_TOKEN');
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.result) return null;
  try {
    return JSON.parse(data.result) as T;
  } catch {
    return data.result as T;
  }
}

async function kvSet(key: string, value: unknown) {
  const url = envOrDie('KV_REST_API_URL');
  const token = envOrDie('KV_REST_API_TOKEN');
  const res = await fetch(
    `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error('KV set failed');
}

async function kvZadd(key: string, score: number, member: string) {
  const url = envOrDie('KV_REST_API_URL');
  const token = envOrDie('KV_REST_API_TOKEN');
  const res = await fetch(`${url}/zadd/${encodeURIComponent(key)}/${score}/${encodeURIComponent(member)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('KV zadd failed');
}

async function kvZrange(key: string, start = 0, stop = -1): Promise<string[]> {
  const url = envOrDie('KV_REST_API_URL');
  const token = envOrDie('KV_REST_API_TOKEN');
  const res = await fetch(`${url}/zrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.result) ? data.result : [];
}

async function kvMget<T = unknown>(keys: string[]): Promise<(T | null)[]> {
  return await Promise.all(keys.map((k) => kvGet<T>(k)));
}

export async function GET() {
  try {
    const ids: string[] = await kvZrange(INDEX_KEY, 0, -1);
    ids.reverse(); // свіжіші вгорі
    if (!ids.length) return NextResponse.json({ ok: true, items: [] });
    const raw = await kvMget<Campaign>(ids.map(ITEM));
    const items = raw.filter(Boolean) as Campaign[];
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const required = ['from_pipeline_id', 'from_status_id', 'to_pipeline_id', 'to_status_id'];
    for (const key of required) {
      if (!body?.[key]) {
        return NextResponse.json({ ok: false, error: `Missing field: ${key}` }, { status: 400 });
      }
    }

    const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    const nowIso = new Date().toISOString();

    const item: Campaign = {
      id,
      created_at: nowIso,
      from_pipeline_id: String(body.from_pipeline_id),
      from_status_id: String(body.from_status_id),
      to_pipeline_id: String(body.to_pipeline_id),
      to_status_id: String(body.to_status_id),
      expires_at: body.expires_at ? String(body.expires_at) : null,
      note: body.note ? String(body.note) : null,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    };

    await kvSet(ITEM(id), item);
    await kvZadd(INDEX_KEY, Date.now(), id);

    return NextResponse.json({ ok: true, id, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
