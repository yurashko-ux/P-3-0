// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

type Any = Record<string, any>;

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

async function loadByIndex(): Promise<Any[]> {
  const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
  if (!ids?.length) return [];
  const raws = (await redis.mget(...ids.map(ITEM_KEY))) as (string | null)[];
  return (raws || [])
    .map((raw) => {
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    })
    .filter(Boolean) as Any[];
}

async function scanFallbackAndHealIndex(): Promise<Any[]> {
  // шукаємо всі campaigns:* (окрім самого індексу)
  const keys = (await redis.keys('campaigns:*')) as string[];
  const docKeys = (keys || []).filter((k) => k !== INDEX_KEY && !k.endsWith(':index'));
  if (!docKeys.length) return [];

  const raws = (await redis.mget(...docKeys)) as (string | null)[];
  const items = (raws || [])
    .map((raw) => {
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    })
    .filter(Boolean) as Any[];

  // відбудуємо індекс, якщо він порожній
  if (items.length) {
    const members = items
      .filter((it) => it?.id)
      .map((it) => ({ score: Number(it.created_at) || Date.now(), member: String(it.id) }));
    if (members.length) {
      await redis.zadd(INDEX_KEY, ...members);
    }
  }
  // повертаємо у зворотному порядку (новіші зверху)
  return items.sort((a, b) => (Number(b?.created_at || 0) - Number(a?.created_at || 0)));
}

export async function GET() {
  try {
    let items = await loadByIndex();

    if (!items.length) {
      // fallback + самовідновлення індексу
      items = await scanFallbackAndHealIndex();
    }

    const payload = {
      ok: true,
      items,
      data: { items },
      campaigns: items,
      rows: items,
      count: items.length,
    };
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'GET_FAILED' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Any;

    const name = (body.name ?? '').toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: 'NAME_REQUIRED' }, { status: 400 });

    const now = Date.now();
    const id = genId();

    const item: Any = {
      ...body,
      id,
      name,
      created_at: now,
      updated_at: now,
    };

    if (item.enabled === undefined) item.enabled = true;
    if (item.exp_days != null) item.exp_days = Number(item.exp_days);
    if (item.lastRun === undefined) item.lastRun = null;
    if (item.v1_count == null) item.v1_count = 0;
    if (item.v2_count == null) item.v2_count = 0;
    if (item.exp_count == null) item.exp_count = 0;

    item.base_pipeline_id = item.base_pipeline_id ?? null;
    item.base_status_id = item.base_status_id ?? null;
    item.v1_to_pipeline_id = item.v1_to_pipeline_id ?? null;
    item.v1_to_status_id = item.v1_to_status_id ?? null;
    item.v2_to_pipeline_id = item.v2_to_pipeline_id ?? null;
    item.v2_to_status_id = item.v2_to_status_id ?? null;

    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'POST_FAILED' }, { status: 500 });
  }
}
