// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { assertAdmin } from '@/lib/auth';

// клавіші
const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

// допоміжне: safe parse
function parse<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// гарантуємо мінімально потрібні поля для UI
function normalizeCampaign(input: any) {
  const now = Date.now();
  const id = input?.id || (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const rules = input?.rules || {};
  const v1 = rules?.v1 || {};
  const v2 = rules?.v2 || {};
  const exp = input?.exp;

  return {
    id,
    name: String(input?.name ?? 'Без назви'),
    created_at: Number(input?.created_at ?? now),
    active: Boolean(input?.active ?? false),
    base_pipeline_id: Number(input?.base_pipeline_id ?? 0),
    base_status_id: Number(input?.base_status_id ?? 0),
    rules: {
      v1: { op: (v1?.op === 'equals' ? 'equals' : 'contains'), value: String(v1?.value ?? '') },
      v2: { op: (v2?.op === 'equals' ? 'equals' : 'contains'), value: String(v2?.value ?? '') },
    },
    exp: exp
      ? {
          days: Number(exp?.days ?? 0),
          to_pipeline_id: Number(exp?.to_pipeline_id ?? 0),
          to_status_id: Number(exp?.to_status_id ?? 0),
        }
      : undefined,
    v1_count: Number(input?.v1_count ?? 0),
    v2_count: Number(input?.v2_count ?? 0),
    exp_count: Number(input?.exp_count ?? 0),

    // назви можуть підставлятись kc-cache згодом; UI нормально відобразить id, якщо назв нема
    base_pipeline_name: input?.base_pipeline_name ?? null,
    base_status_name: input?.base_status_name ?? null,
    exp_to_pipeline_name: input?.exp_to_pipeline_name ?? null,
    exp_to_status_name: input?.exp_to_status_name ?? null,
  };
}

export const dynamic = 'force-dynamic';

// GET: список кампаній з індексу (найновіші першими)
export async function GET() {
  try {
    const ids = await redis.zrange(INDEX_KEY, 0, -1, { rev: true }).catch(() => []);
    if (!ids?.length) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
    }

    // mget по всіх ключах і парсимо
    const raws = await redis.mget(...ids.map(ITEM_KEY));
    const items = (raws || [])
      .map((r) => parse(r))
      .filter(Boolean)
      .map((c) => {
        // гарантуємо наявність rules.v1/v2 навіть якщо відсутні у сховищі
        const n = normalizeCampaign(c);
        return n;
      });

    return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// POST: створення/апсертування кампанії + індексація у ZSET
export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const body = await req.json().catch(() => ({}));
    const campaign = normalizeCampaign(body);

    // зберегти item
    await redis.set(ITEM_KEY(campaign.id), JSON.stringify(campaign));
    // індексувати за created_at
    await redis.zadd(INDEX_KEY, { score: campaign.created_at, member: campaign.id });

    return NextResponse.json({ ok: true, campaign }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
