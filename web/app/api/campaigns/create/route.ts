// web/app/api/campaigns/create/route.ts
import { NextResponse } from 'next/server';
import { kvSet, kvZAdd } from '@/lib/kv';

export const dynamic = 'force-dynamic';

function isAuthorized(req: Request): boolean {
  const pass = process.env.ADMIN_PASS || '';
  if (!pass) return true;

  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_pass=([^;]+)/.exec(cookie);
  const fromCookie = m?.[1] || '';

  return bearer === pass || fromCookie === pass;
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const b = await req.json().catch(() => null);
    if (!b || !b.name) {
      return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 400 });
    }

    const now = Date.now();
    const id =
      b.id ||
      (globalThis.crypto?.randomUUID?.() ??
        `MF${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`);

    const item = {
      id,
      created_at: new Date(now).toISOString(),
      name: String(b.name ?? ''),

      base_pipeline_id: String(b.base_pipeline_id ?? ''),
      base_status_id: String(b.base_status_id ?? ''),

      // V1 (обов'язково)
      v1_field: b.v1_field ?? 'text',
      v1_op: b.v1_op ?? 'contains',
      v1_value: String(b.v1_value ?? ''),
      v1_to_pipeline_id: b.v1_to_pipeline_id != null ? String(b.v1_to_pipeline_id) : null,
      v1_to_status_id: b.v1_to_status_id != null ? String(b.v1_to_status_id) : null,

      // V2 (опційно)
      v2_enabled: !!b.v2_enabled,
      v2_field: b.v2_field ?? 'text',
      v2_op: b.v2_op ?? 'contains',
      v2_value: String(b.v2_value ?? ''),
      v2_to_pipeline_id: b.v2_to_pipeline_id != null ? String(b.v2_to_pipeline_id) : null,
      v2_to_status_id: b.v2_to_status_id != null ? String(b.v2_to_status_id) : null,

      // Expire
      exp_days: Number.isFinite(b.exp_days) ? Number(b.exp_days) : 7,
      exp_to_pipeline_id: b.exp_to_pipeline_id != null ? String(b.exp_to_pipeline_id) : null,
      exp_to_status_id: b.exp_to_status_id != null ? String(b.exp_to_status_id) : null,

      note: b.note ?? null,
      enabled: b.enabled !== false,

      // лічильники за замовчуванням
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    await kvSet(`campaigns:${id}`, JSON.stringify(item));
    await kvZAdd('campaigns:index', now, id);

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'internal' },
      { status: 500 },
    );
  }
}
