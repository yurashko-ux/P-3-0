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

// ✅ LPUSH: шляховий варіант — кожне значення передаємо у path (не в JSON body)
async function kvLPush(key: string, ...values: string[]) {
  const pathValues = values.map(encodeURIComponent).join('/');
  return kvGET(`/lpush/${encodeURIComponent(key)}/${pathValues}`, { method: 'POST' });
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

// допоміжне: розпрямляємо старі зіпсовані елементи типу ["id"] -> id
function normalizeIndex(raw: any): string[] {
  const list: string[] = Array.isArray(raw?.result) ? raw.result : [];
  return list.map((v) => {
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string') {
          return parsed[0];
        }
      } catch { /* ignore */ }
      return v;
    }
    return String(v);
  });
}

// GET: подивитися індекс і перший елемент, якщо є
export async function GET() {
  if (!hasKV()) return NextResponse.json({ ok:false, error:'KV not configured' }, { status: 500 });

  const rawIdx = await kvLRange(INDEX_KEY, 0, -1).catch(() => ({ result: [] as string[] }));
  const index = normalizeIndex(rawIdx);
  const firstId = index[0];
  const first = firstId ? await kvGet(ITEM_KEY(firstId)).catch(() => ({})) : null;

  return NextResponse.json(
    { ok:true, index, sampleId:firstId, sample:first?.result ?? null },
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
    pair_lookup_success_count: 0,
    pair_lookup_fail_count: 0,
    pair_move_success_count: 0,
    pair_move_fail_count: 0,
  };

  const setRes = await kvSet(ITEM_KEY(id), item);
  // ✅ пушимо чисте значення id
  const pushRes = await kvLPush(INDEX_KEY, id);
  const index = normalizeIndex(await kvLRange(INDEX_KEY, 0, -1).catch(() => ({ result: [] })));

  return NextResponse.json(
    { ok:true, created:id, setRes, pushRes, index },
    { headers: { 'Cache-Control':'no-store' } }
  );
}
