// web/app/api/mc/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------- helpers ----------
function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}
function bad(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
function normalize(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
function matchCond(
  text: string,
  cond: { op: 'contains' | 'equals'; value: string } | null
): boolean {
  if (!cond) return false;
  const t = normalize(text);
  const v = normalize(cond.value);
  if (!v) return false;
  return cond.op === 'equals' ? t === v : t.includes(v);
}
function deepParse<T = any>(raw: string): T | null {
  try {
    const first = JSON.parse(raw);
    if (first && typeof first === 'object' && !('value' in (first as any)))
      return first as T;
    const v = (first as any)?.value;
    if (typeof v === 'string') {
      try { return JSON.parse(v) as T; } catch { return null; }
    }
    if (v && typeof v === 'object') return v as T;
    return null;
  } catch { return null; }
}

// ---- robust card_id resolver (supports various KV formats) ----
async function resolveCardId(
  req: NextRequest,
  username: string,
  bodyCard?: string
): Promise<string | null> {
  // 1) explicit card_id in query/body (for quick tests)
  const url = new URL(req.url);
  const qCard = url.searchParams.get('card_id');
  if (qCard) return qCard.trim();
  if (bodyCard) return String(bodyCard).trim();

  // 2) KV map: map:ig:{username} -> card_id
  const key = `map:ig:${String(username || '').trim().toLowerCase()}`;
  const raw = await kvGet(key);
  if (typeof raw === 'string' && raw) {
    try {
      const obj = JSON.parse(raw);
      if (typeof obj === 'string') return obj.trim();
      if (obj && typeof obj === 'object') {
        if (typeof (obj as any).value === 'string') return (obj as any).value.trim();
        if (typeof (obj as any).id === 'string') return (obj as any).id.trim();
        if (typeof (obj as any).result === 'string') return (obj as any).result.trim();
      }
    } catch {
      return raw.trim(); // plain string
    }
  }

  // 3) TODO: search KeyCRM by username
  return null;
}

// ---------- handler ----------
export async function POST(req: NextRequest) {
  // Auth: ManiChat token (Bearer or ?token=)
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
  if (!card_id) {
    return ok({
      applied: null,
      note:
        'card not found by username (set map:ig:{username} via /api/map/ig or pass ?card_id=)',
    });
  }

  // 1) load campaigns
  const ids = await kvZRange('campaigns:index', 0, -1);
  const campaigns: any[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    const c = deepParse<any>(raw);
    if (c?.enabled) campaigns.push(c);
  }

  // 2) choose match (V2 has priority)
  let chosen:
    | {
        id: string;
        variant: 'v1' | 'v2';
        to_pipeline_id: string | null;
        to_status_id: string | null;
      }
    | null = null;

  for (const c of campaigns) {
    const v2hit =
      c.v2_enabled &&
      matchCond(text, c.v2_value ? { op: c.v2_op || 'contains', value: c.v2_value } : null);
    const v1hit =
      !v2hit &&
      matchCond(text, c.v1_value ? { op: c.v1_op || 'contains', value: c.v1_value } : null);

    if (v2hit)
      chosen = {
        id: c.id,
        variant: 'v2',
        to_pipeline_id: c.v2_to_pipeline_id,
        to_status_id: c.v2_to_status_id,
      };
    else if (v1hit)
      chosen = {
        id: c.id,
        variant: 'v1',
        to_pipeline_id: c.v1_to_pipeline_id,
        to_status_id: c.v1_to_status_id,
      };

    if (chosen) break; // first applicable campaign
  }

  if (!chosen) return ok({ applied: null });

  // 3) move card via internal proxy — ТЕПЕР З ДЕТАЛЯМИ ВІДПОВІДІ
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

  const moveStatus = moveResp.status;
  const moveText = await moveResp.text();
  let moveJson: any = null;
  try { moveJson = JSON.parse(moveText); } catch {}
  const movePayload = moveJson ?? { text: moveText };

  // Вважаємо помилкою будь-який !ok статус АБО експліцитне { ok:false } у json
  const moveOk = moveResp.ok && (moveJson == null || moveJson.ok !== false);
  if (!moveOk) {
    return bad(502, 'keycrm move failed', {
      status: moveStatus,
      move: movePayload,
      sent: {
        card_id,
        to_pipeline_id: chosen.to_pipeline_id,
        to_status_id: chosen.to_status_id,
      },
    });
  }

  // 4) increment counters
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
