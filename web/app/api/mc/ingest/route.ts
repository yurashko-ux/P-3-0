// web/app/api/mc/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------- small utils ----------
const ok  = (data: any = {}) => NextResponse.json({ ok: true,  ...data });
const bad = (status: number, error: string, extra?: any) =>
  NextResponse.json({ ok: false, error, ...extra }, { status });

const normalize = (s: unknown) =>
  String(s ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');

const matchCond = (text: string, cond: { op: 'contains'|'equals'; value: string } | null) => {
  if (!cond) return false;
  const t = normalize(text), v = normalize(cond.value);
  if (!v) return false;
  return cond.op === 'equals' ? t === v : t.includes(v);
};

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

async function resolveCardId(req: NextRequest, username: string, bodyCard?: string) {
  const url = new URL(req.url);
  const qCard = url.searchParams.get('card_id');
  if (qCard) return qCard.trim();
  if (bodyCard) return String(bodyCard).trim();

  const key = `map:ig:${String(username || '').trim().toLowerCase()}`;
  const raw = await kvGet(key);
  if (typeof raw === 'string' && raw) {
    try {
      const obj = JSON.parse(raw);
      if (typeof obj === 'string') return obj.trim();
      if (obj && typeof obj === 'object') {
        if (typeof (obj as any).value === 'string') return (obj as any).value.trim();
        if (typeof (obj as any).id === 'string')    return (obj as any).id.trim();
        if (typeof (obj as any).result === 'string')return (obj as any).result.trim();
      }
    } catch { return raw.trim(); }
  }
  return null;
}

// ---- direct KeyCRM call helpers ----
const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

function coerceNumOrNull(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Пробуємо кілька варіантів оновлення картки.
 * ВАЖЛИВО: не зупиняємось на 405/404 — пробуємо наступні, зупиняємось лише на 2xx або 401/403/5xx.
 */
async function tryKeycrmMove(
  baseUrl: string,
  token: string,
  card_id: string,
  to_pipeline_id: string | null,
  to_status_id: string | null
) {
  const headers: Record<string,string> = {
    Authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const pid = to_pipeline_id != null ? coerceNumOrNull(to_pipeline_id) : null;
  const sid = to_status_id   != null ? coerceNumOrNull(to_status_id)   : null;
  const body = { pipeline_id: pid, status_id: sid };

  // Першим ставимо саме PUT pipelines/cards/{id} — за підказкою 405 Allowed: PUT.
  const attempts: Array<{name:string; url:string; method:'PATCH'|'PUT'|'POST'; body:any}> = [
    { name: 'PUT pipelines/cards/{id}',   url: join(baseUrl, `/pipelines/cards/${encodeURIComponent(card_id)}`), method: 'PUT',   body },
    { name: 'PATCH pipelines/cards/{id}', url: join(baseUrl, `/pipelines/cards/${encodeURIComponent(card_id)}`), method: 'PATCH', body },
    { name: 'PUT pipelines/card/{id}',    url: join(baseUrl, `/pipelines/card/${encodeURIComponent(card_id)}`),  method: 'PUT',   body },
    { name: 'PATCH pipelines/card/{id}',  url: join(baseUrl, `/pipelines/card/${encodeURIComponent(card_id)}`),  method: 'PATCH', body },
    { name: 'POST pipelines/cards/move',  url: join(baseUrl, `/pipelines/cards/move`),                           method: 'POST',  body: { card_id, pipeline_id: pid, status_id: sid } },
    { name: 'POST cards/{id}/move',       url: join(baseUrl, `/cards/${encodeURIComponent(card_id)}/move`),      method: 'POST',  body: { pipeline_id: pid, status_id: sid } },
    { name: 'PUT cards/{id}',             url: join(baseUrl, `/cards/${encodeURIComponent(card_id)}`),           method: 'PUT',   body },
    { name: 'PATCH cards/{id}',           url: join(baseUrl, `/cards/${encodeURIComponent(card_id)}`),           method: 'PATCH', body },
  ];

  let last: any = { ok: false };
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, { method: a.method, headers, body: JSON.stringify(a.body), cache: 'no-store' });
      const text = await r.text();
      let j: any = null; try { j = JSON.parse(text); } catch {}
      const success = r.ok && (j == null || j.ok === undefined || j.ok === true);
      if (success) return { ok: true, via: a.name, status: r.status, response: j ?? text };

      last = { ok: false, via: a.name, status: r.status, responseText: text, responseJson: j ?? null };

      // тільки для серйозних кодів зупиняємось; на 404/405/400 йдемо далі
      if (r.status === 401 || r.status === 403 || r.status >= 500) break;
    } catch (e: any) {
      last = { ok: false, via: a.name, status: 0, error: String(e) };
      break; // мережевий фейл — стоп
    }
  }
  return last;
}

// ---------- handler ----------
export async function POST(req: NextRequest) {
  // ManiChat auth
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token  = bearer || new URL(req.url).searchParams.get('token') || '';
  if (!process.env.MC_TOKEN || token !== process.env.MC_TOKEN) {
    return bad(401, 'unauthorized');
  }

  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const text     = String(body.text || '');
  if (!username) return bad(400, 'username required');

  // resolve card
  const card_id = await resolveCardId(req, username, body.card_id);
  if (!card_id) {
    return ok({ applied: null, note: 'card not found by username (set map:ig:{username} via /api/map/ig or pass ?card_id=)' });
  }

  // load enabled campaigns
  const ids = await kvZRange('campaigns:index', 0, -1);
  const campaigns: any[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    const c = deepParse<any>(raw);
    if (c?.enabled) campaigns.push(c);
  }

  // pick first match (V2 priority)
  let chosen: { id: string; variant: 'v1'|'v2'; to_pipeline_id: string|null; to_status_id: string|null } | null = null;
  for (const c of campaigns) {
    const v2hit = c.v2_enabled && matchCond(text, c.v2_value ? { op: c.v2_op || 'contains', value: c.v2_value } : null);
    const v1hit = !v2hit     && matchCond(text, c.v1_value ? { op: c.v1_op || 'contains', value: c.v1_value } : null);
    if (v2hit)      chosen = { id: c.id, variant: 'v2', to_pipeline_id: c.v2_to_pipeline_id, to_status_id: c.v2_to_status_id };
    else if (v1hit) chosen = { id: c.id, variant: 'v1', to_pipeline_id: c.v1_to_pipeline_id, to_status_id: c.v1_to_status_id };
    if (chosen) break;
  }
  if (!chosen) return ok({ applied: null });

  // KeyCRM env (token/base with fallbacks)
  const KEYCRM_TOKEN =
    process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || '';
  const KEYCRM_BASE =
    process.env.KEYCRM_BASE_URL || process.env.KEYCRM_API_URL || process.env.KEYCRM_URL || '';

  if (!KEYCRM_TOKEN || !KEYCRM_BASE) {
    return bad(500, 'keycrm not configured', {
      need: { KEYCRM_API_TOKEN_or_BEARER: !!KEYCRM_TOKEN, KEYCRM_BASE_URL_or_ALTS: !!KEYCRM_BASE },
    });
  }

  // move card
  const move = await tryKeycrmMove(KEYCRM_BASE, KEYCRM_TOKEN, card_id, chosen.to_pipeline_id, chosen.to_status_id);
  if (!move.ok) {
    return bad(502, 'keycrm move failed', {
      status: move.status ?? 0,
      via: move.via,
      move: move.responseJson ?? move.responseText ?? move.error ?? null,
      sent: { card_id, to_pipeline_id: chosen.to_pipeline_id, to_status_id: chosen.to_status_id },
    });
  }

  // counters
  const key = `campaigns:${chosen.id}`;
  const raw = await kvGet(key);
  if (raw) {
    const c = deepParse<any>(raw) || {};
    if (chosen.variant === 'v1') c.v1_count = (Number(c.v1_count) || 0) + 1;
    else                        c.v2_count = (Number(c.v2_count) || 0) + 1;
    try { await kvSet(key, JSON.stringify(c)); } catch {}
  }

  return ok({ applied: chosen.variant, campaign_id: chosen.id, move: { via: move.via, status: move.status } });
}
