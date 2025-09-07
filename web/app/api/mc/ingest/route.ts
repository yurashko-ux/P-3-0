// web/app/api/mc/ingest/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvZRange } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Спрощені локальні типи (узгоджені з /api/campaigns)
type Condition = { field: 'text'|'flow'|'tag'|'any'; op: 'contains'|'equals'; value: string };
type Campaign = {
  id: string;
  created_at: string;
  name: string;

  base_pipeline_id: string | null;
  base_status_id: string | null;

  v1_condition: Condition | null;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;

  v2_condition: Condition | null;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;

  exp_days: number | null;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;

  note?: string | null;
  enabled: boolean;

  v1_count: number;
  v2_count: number;
  exp_count: number;
};

function ok(data: any, status = 200) { return NextResponse.json(data, { status }); }
function bad(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }); }

function isAuthorized(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const tokenFromHeader = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get('token') || '';
  const token = tokenFromHeader || tokenFromQuery;
  const expected = process.env.MC_TOKEN || '';
  return expected ? token === expected : true; // якщо токену в ENV нема — не блокуємо
}

function pickUsername(body: any): string | null {
  return (
    body?.username ||
    body?.ig_username ||
    body?.user?.username ||
    body?.sender?.username ||
    body?.user?.name ||
    null
  );
}

function pickText(body: any): string {
  return (
    body?.text ||
    body?.message ||
    body?.payload?.text ||
    ''
  );
}

function matchCondition(cond: Condition | null, payload: { text: string }): boolean {
  if (!cond) return false;
  if (cond.field === 'any') return true;
  const source = cond.field === 'text' ? (payload.text || '') : '';
  const s = String(source).toLowerCase();
  const v = String(cond.value || '').toLowerCase();
  return cond.op === 'equals' ? s === v : s.includes(v);
}

async function loadAllCampaigns(): Promise<Campaign[]> {
  const ids = await kvZRange('campaigns:index', 0, -1);
  const res: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`); // <-- БЕЗ generic
    if (!raw) continue;
    try { res.push(JSON.parse(raw) as Campaign); } catch {}
  }
  return res;
}

/**
 * На цьому кроці лишаємо мінімальну реалізацію ingest:
 * - авторизація по MC_TOKEN
 * - нормалізація payload (username, text)
 * - завантаження активних кампаній із KV
 * - повертаємо matches (без переміщення картки — це зробимо наступним кроком)
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return bad('unauthorized', 401);

  const body = await req.json().catch(() => ({} as any));
  const username = pickUsername(body);
  const text = pickText(body);

  if (!username) return bad('missing username', 400);

  const campaigns = await loadAllCampaigns();
  const active = campaigns.filter(c => c.enabled);

  // Проста перевірка збігів: v1 / v2 по тексту (для smoke-тесту)
  const matches = active
    .map((c) => {
      const v1 = matchCondition(c.v1_condition, { text });
      const v2 = matchCondition(c.v2_condition, { text });
      const variant = v1 ? 'v1' : (v2 ? 'v2' : null);
      return variant ? { campaign_id: c.id, variant } : null;
    })
    .filter(Boolean) as Array<{campaign_id: string; variant: 'v1'|'v2'}>;

  return ok({
    ok: true,
    username,
    text,
    matched: matches,
    // Поки що тільки «dry-run». Переміщення і counters додамо після перевірки збереження кампаній.
  });
}
