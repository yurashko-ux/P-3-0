// web/app/api/campaigns/create/route.ts
import { NextResponse } from 'next/server';
import { kvSet, kvZadd } from '@/lib/kv';

export const dynamic = 'force-dynamic';

type Op = 'contains' | 'equals';

function s(x: any, def = ''): string {
  return x === undefined || x === null ? def : String(x);
}
function n(x: any, def = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : def;
}
function id(): string {
  // crypto.randomUUID в edge/Node18
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '');
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const _id = s(body.id) || id();
    const nowIso = new Date().toISOString();

    const item = {
      id: _id,
      created_at: nowIso,
      updated_at: nowIso,

      name: s(body.name),
      base_pipeline_id: s(body.base_pipeline_id),
      base_status_id: s(body.base_status_id),

      // Варіант 1 (обов'язковий)
      v1_field: s(body.v1_field || 'text'),
      v1_op: (s(body.v1_op || 'contains') as Op),
      v1_value: s(body.v1_value || ''),
      v1_to_pipeline_id: body.v1_to_pipeline_id ?? null,
      v1_to_status_id: body.v1_to_status_id ?? null,

      // Варіант 2 (опційний)
      v2_enabled: !!body.v2_enabled && !!s(body.v2_value),
      v2_field: s(body.v2_field || 'text'),
      v2_op: (s(body.v2_op || 'contains') as Op),
      v2_value: s(body.v2_value || ''),
      v2_to_pipeline_id: body.v2_enabled ? (body.v2_to_pipeline_id ?? null) : null,
      v2_to_status_id: body.v2_enabled ? (body.v2_to_status_id ?? null) : null,

      // Expire
      exp_days: n(body.exp_days, 7),
      exp_to_pipeline_id: body.exp_to_pipeline_id ?? null,
      exp_to_status_id: body.exp_to_status_id ?? null,

      enabled: body.enabled !== false,

      // Лічильники
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    // зберегти саму кампанію
    await kvSet(`campaigns:${_id}`, JSON.stringify(item));
    // додати в індекс (сортуємо по часу)
    await kvZadd('campaigns:index', Date.now(), _id);

    return NextResponse.json({ ok: true, id: _id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'save failed' },
      { status: 500 }
    );
  }
}
