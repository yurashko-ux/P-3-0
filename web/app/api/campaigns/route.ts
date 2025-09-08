// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';

type Op = 'contains' | 'equals';

const ADMIN = process.env.ADMIN_PASS ?? '';

function okAuth(req: Request) {
  const bearer = req.headers.get('authorization') || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const cookiePass = cookies().get('admin_pass')?.value || '';
  const pass = token || cookiePass;
  return !ADMIN || pass === ADMIN;
}

function str(v: any, d = '') { return v == null ? d : String(v); }
function num(v: any, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function newId() {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '');
}

// ----- GET: список кампаній -----
export async function GET() {
  try {
    const ids = await kvZRange('campaigns:index', 0, -1) as string[] | any;
    const out: any[] = [];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const raw = await kvGet(`campaigns:${id}`);
        if (raw) {
          try { out.push(JSON.parse(raw)); } catch {}
        }
      }
    }
    return NextResponse.json({ ok: true, items: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'list failed' }, { status: 500 });
  }
}

// ----- POST: створення кампанії -----
export async function POST(req: Request) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const b = await req.json().catch(() => ({}));

    const id = str(b.id) || newId();
    const now = new Date().toISOString();

    const item = {
      id,
      created_at: now,
      updated_at: now,

      name: str(b.name),
      base_pipeline_id: str(b.base_pipeline_id),
      base_status_id: str(b.base_status_id),

      // V1 (обов’язково)
      v1_field: str(b.v1_field || 'text'),
      v1_op: str(b.v1_op || 'contains') as Op,
      v1_value: str(b.v1_value || ''),
      v1_to_pipeline_id: b.v1_to_pipeline_id ?? null,
      v1_to_status_id: b.v1_to_status_id ?? null,

      // V2 (опційно)
      v2_enabled: !!b.v2_enabled && !!str(b.v2_value),
      v2_field: str(b.v2_field || 'text'),
      v2_op: str(b.v2_op || 'contains') as Op,
      v2_value: str(b.v2_value || ''),
      v2_to_pipeline_id: (b.v2_enabled ? b.v2_to_pipeline_id : null) ?? null,
      v2_to_status_id: (b.v2_enabled ? b.v2_to_status_id : null) ?? null,

      // Expire
      exp_days: num(b.exp_days, 7),
      exp_to_pipeline_id: b.exp_to_pipeline_id ?? null,
      exp_to_status_id: b.exp_to_status_id ?? null,

      enabled: b.enabled !== false,

      // лічильники
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    await kvSet(`campaigns:${id}`, JSON.stringify(item));
    await kvZAdd('campaigns:index', Date.now(), id);

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'save failed' }, { status: 500 });
  }
}
