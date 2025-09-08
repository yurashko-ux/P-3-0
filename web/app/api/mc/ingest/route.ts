// web/app/api/mc/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any = {}) { return NextResponse.json({ ok: true, ...data }); }
function bad(status: number, error: string, extra?: any) { return NextResponse.json({ ok: false, error, ...extra }, { status }); }

function normalize(s: unknown): string {
  return String(s ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}
function matchCond(text: string, cond: { op: 'contains'|'equals'; value: string } | null): boolean {
  if (!cond) return false;
  const t = normalize(text), v = normalize(cond.value);
  if (!v) return false;
  return cond.op === 'equals' ? (t === v) : t.includes(v);
}
function deepParse<T = any>(raw: string): T | null {
  try {
    const first = JSON.parse(raw);
    if (first && typeof first === 'object' && !('value' in (first as any))) return first as T;
    const v = (first as any)?.value;
    if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
    if (v && typeof v === 'object') return v as T;
    return null;
  } catch { return null; }
}

async function resolveCardId(req: NextRequest, username: string, bodyCard?: string): Promise<string | null> {
  // 1) явний card_id у запиті (для швидкого е2е тесту)
  const url = new URL(req.url);
  const qCard = url.searchParams.get('card_id');
  if (qCard) return qCard;
  if (bodyCard) return bodyCard;

  // 2) KV-мапа map:ig:{username} -> card_id (налаштуємо тулом на наступному кроці)
  const mapped = await kvGet(`map:ig:${username}`);
  if (typeof mapped === 'string' && mapped) {
    try {
      // допускаємо як plain string, так і {"value":"<id>"}
      const v = deepParse<{ id?: string }>(mapped);
      if (typeof v === 'string') return v;
      if (v?.id) return v.id;
      // якщо був просто рядок
      return mapped;
    } catch { return mapped; }
  }

  // 3) TODO: окремий проксі до KeyCRM (не робимо зараз)
  return null;
}

export async function POST(req: NextRequest) {
  // авторизація ManiChat токеном (Bearer або ?token=)
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || new URL(req.url).searchParams.get('token') || '';
  if (!process.env.MC_TOKEN || token !== process.env.MC_TOKEN) {
    return bad(401, 'unauthorized');
  }

  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const text = String(body.text || '');
  if (!username) return bad(400, 'username required');

  const card_id = await resolveCardId(req, username, body.card_id);
  if (!card_id) return ok({ applied: null, note: 'card not found by username (set map:ig:{username} or pass ?card_id=)' });

  // 1) зчитати кампанії
  const ids = await kvZRange('campaigns:index', 0, -1);
  const campaigns: any[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    const c = deepParse<any>(raw);
    if (c?.enabled) campaigns.push(c);
  }

  // 2) визначити спрацювання (V2 має пріоритет)
  let chosen: { id: string; variant: 'v1'|'v2'; to_pipeline_id: string|null; to_status_id: string|null } | null = null;
  for (const c of campaigns) {
    const v2hit = c.v2_enabled && matchCond(text, c.v2_value ? { op: c.v2_op || 'contains', value: c.v2_value } : null);
    const v1hit = !v2hit && matchCond(text, c.v1_value ? { op: c.v1_op || 'contains', value: c.v1_value } : null);
    if (v2hit) chosen = { id: c.id, variant: 'v2', to_pipeline_id: c.v2_to_pipeline_id, to_status_id: c.v2_to_status_id };
    else if (v1hit) chosen = { id: c.id, variant: 'v1', to_pipeline_id: c.v1_to_pipeline_id, to_status_id: c.v1_to_status_id };
    if (chosen) break; // перша релевантна кампанія
  }

  if (!chosen) return ok({ applied: null });

  // 3) рух картки через внутрішній проксі
  const origin = new URL(req.url).origin;
  const moveResp = await fetch(`${origin}/api/keycrm/card/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_id,
      to_pipeline_id: chosen.to_pipeline_id,
      to_status_id: chosen.to_status_id,
    }),
  });
  const move = await moveResp.json().catch(() => ({ ok: false }));
  if (!move?.ok) return bad(502, 'keycrm move failed');

  // 4) інкремент лічильника
  const key = `campaigns:${chosen.id}`;
  const raw = await kvGet(key);
  if (raw) {
    const c = deepParse<any>(raw) || {};
    if (chosen.variant === 'v1') c.v1_count = (Number(c.v1_count) || 0) + 1;
    else c.v2_count = (Number(c.v2_count) || 0) + 1;
    try { await kvSet(key, JSON.stringify(c)); } catch {}
  }

  return ok({ applied: chosen.variant, campaign_id: chosen.id });
}
