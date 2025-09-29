// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';

// --- KV REST helpers (без зовнішніх залежностей) ---
const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const WR = process.env.KV_REST_API_TOKEN || '';
const RO = process.env.KV_REST_API_READ_ONLY_TOKEN || WR;

const INDEX_KEY = 'campaign:index';
const ITEM_KEY  = (id: string) => `campaign:${id}`;

function h(ro = false) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ro ? RO : WR}`,
  };
}
async function restGet(path: string, ro = true) {
  const res = await fetch(`${BASE}/${path}`, { headers: h(ro), cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}
async function restPost(path: string, body: any, ro = false) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: h(ro),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}
async function kvGet(key: string): Promise<string | null> {
  try {
    const r = await restGet(`get/${encodeURIComponent(key)}`, true);
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      return typeof j === 'string' ? j : (j?.result ?? j?.value ?? null);
    } catch {
      return t || null;
    }
  } catch {
    return null;
  }
}
async function kvSet(key: string, value: string) {
  await restPost(`set/${encodeURIComponent(key)}`, { value }, false);
}
async function kvLRangeAll(key: string): Promise<string[]> {
  const r = await restGet(`lrange/${encodeURIComponent(key)}/0/-1`, true).catch(() => null);
  if (!r) return [];
  const t = await r.text().catch(() => '');
  try {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : (Array.isArray(j?.result) ? j.result : (Array.isArray(j?.data) ? j.data : []));
    return arr.map((x: any) => (typeof x === 'string' ? x : (x?.value ?? x?.member ?? x?.id ?? ''))).filter(Boolean);
  } catch {
    return [];
  }
}
async function kvLPush(key: string, value: string) {
  await restPost(`lpush/${encodeURIComponent(key)}`, { value }, false);
}

// --- Admin guard (cookie або X-Admin-Token) ---
function readToken(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const c1 = req.cookies.get('admin_token')?.value || '';
  const c2 = req.cookies.get('admin_pass')?.value || '';
  return header || c1 || c2 || '';
}
function assertAdmin(req: NextRequest) {
  const provided = readToken(req);
  const expected = process.env.ADMIN_PASS || '';
  return expected && provided && provided === expected;
}

// --- Types ---
type Rule = { op: 'contains' | 'equals'; value: string };
type CampaignInput = {
  name?: string;
  base_pipeline_id?: number;
  base_status_id?: number;
  rules?: { v1?: Rule; v2?: Rule };
};

export async function GET(req: NextRequest) {
  try {
    if (!assertAdmin(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    if (!BASE || !WR) {
      return NextResponse.json({ ok: false, error: 'kv_not_configured' }, { status: 500 });
    }

    const ids = await kvLRangeAll(INDEX_KEY);
    const items: any[] = [];
    for (const id of ids) {
      const raw = await kvGet(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (obj && !obj.deleted) items.push(obj);
      } catch {
        // зіпсований json пропускаємо
      }
    }
    return NextResponse.json({ ok: true, count: items.length, items }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!assertAdmin(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    if (!BASE || !WR) {
      return NextResponse.json({ ok: false, error: 'kv_not_configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as CampaignInput;

    const now = Date.now();
    const id = String(now);

    const item = {
      id,
      name: body.name || 'UI-created',
      created_at: now,
      active: false,
      base_pipeline_id: body.base_pipeline_id ?? undefined,
      base_status_id:   body.base_status_id ?? undefined,
      base_pipeline_name: null as null | string,
      base_status_name:   null as null | string,
      rules: {
        v1: body.rules?.v1 && body.rules.v1.value ? body.rules.v1 : undefined,
        v2: body.rules?.v2 && body.rules.v2.value ? body.rules.v2 : undefined,
      },
      exp: {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    // Порядок важливий: спочатку item, потім id в індексі (LPUSH — новий на початку)
    await kvSet(ITEM_KEY(id), JSON.stringify(item));
    await kvLPush(INDEX_KEY, id);

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
