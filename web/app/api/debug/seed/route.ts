// web/app/api/debug/seed/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// --- Upstash REST helpers ---
const URL = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;

function hasKV() { return Boolean(URL && TOKEN); }

async function kvGET(path: string, init?: RequestInit) {
  const r = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  return r.json();
}

// set via REST: /set/<key>/<value>  (value must be encoded)
async function kvSet(key: string, value: any) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  return kvGET(`/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, { method: 'POST' });
}

// lpush via REST with JSON body: ["a","b",...]
async function kvLPush(key: string, ...values: string[]) {
  return kvGET(`/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}

async function kvLRange(key: string, start = 0, stop = -1) {
  return kvGET(`/lrange/${encodeURIComponent(key)}/${start}/${stop}`);
}

async function kvGet(key: string) {
  return kvGET(`/get/${encodeURIComponent(key)}`);
}

// --- keys
const INDEX_KEY = 'campaigns:index:list';
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

// GET: подивитися індекс і перший елемент, якщо є
export async function GET() {
  if (!hasKV()) return NextResponse.json({ ok:false, error:'KV not configured' }, { status: 500 });
  const idx = await kvLRange(INDEX_KEY, 0, -1).catch(() => ({ result: [] as string[] }));
  const firstId = idx?.result?.[0];
  const first = firstId ? await kvGet(ITEM_KEY(firstId)).catch(() => ({})) : null;

  return NextResponse.json(
    { ok:true, index: idx?.result ?? [], sampleId:firstId, sample:first?.result ?? null },
    { headers: { 'Cache-Control':'no-store' } }
  );
}

// POST: створити 1 демо-кампанію і додати в індекс
export async function POST() {
  if (!hasKV()) return NextResponse.json({ ok:false, error:'KV not configured' }, { status: 500 });

  const now = Date.now();
  const id = String(now);

  const item = {
    name: 'Demo campaign',
    created_at: now,
    active: true,
    base_pipeline_id: 111,
    base_status_id: 222,
    base_pipeline_name: 'Нові Ліди',
    base_status_name: 'Ігнорує',
    rules: {
      v1: { op: 'contains', value: 'ціна' },
      v2: { op: 'equals', value: 'привіт' },
    },
    exp: {},
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  const setRes = await kvSet(ITEM_KEY(id), item);
  const pushRes = await kvLPush(INDEX_KEY, id);
  const idx = await kvLRange(INDEX_KEY, 0, -1).catch(() => ({ result: [] as string[] }));

  return NextResponse.json(
    { ok:true, created:id, setRes, pushRes, index: idx?.result ?? [] },
    { headers: { 'Cache-Control':'no-store' } }
  );
}
