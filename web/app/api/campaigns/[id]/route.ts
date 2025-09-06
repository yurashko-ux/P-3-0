// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Any = Record<string, any>;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

async function scanAll(match: string, count = 200): Promise<string[]> {
  let cursor = 0; const acc: string[] = [];
  while (true) {
    const res: any = await (redis as any).scan(cursor, { match, count });
    const next = Array.isArray(res) ? Number(res[0]) : Number(res?.cursor ?? 0);
    const keys = Array.isArray(res) ? (res[1] as string[]) : ((res?.keys as string[]) ?? []);
    if (keys?.length) acc.push(...keys);
    cursor = next; if (!cursor) break;
  }
  return acc;
}

// ---------- GET ----------
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;

  // /api/campaigns/seed  → створює тестову кампанію
  if (id === 'seed') {
    try {
      const now = Date.now();
      const newId = 'SEED_' + genId();
      const item: Any = {
        id: newId,
        name: 'SEED TEST ' + new Date(now).toISOString(),
        enabled: true,
        created_at: now,
        updated_at: now,
        base_pipeline_id: null,
        base_status_id: null,
        v1_field: 'text',
        v1_op: 'contains',
        v1_value: 'yes',
        v1_to_pipeline_id: null,
        v1_to_status_id: null,
      };

      await redis.set(ITEM_KEY(newId), JSON.stringify(item));
      await redis.zadd(INDEX_KEY, { score: now, member: newId });

      const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
      const raws = ids.length ? (await redis.mget(...ids.map(ITEM_KEY))) as (string | null)[] : [];
      const items = (raws || []).map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } }).filter(Boolean);

      return NextResponse.json({ ok: true, created: newId, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || 'SEED_FAILED' }, { status: 500 });
    }
  }

  // /api/campaigns/debug → показує стан KV/індексу
  if (id === 'debug') {
    try {
      const env = {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
      };

      let canWrite = false, writeError = '';
      try {
        const probe = `campaigns:__probe__:${Date.now()}`;
        await redis.set(probe, JSON.stringify({ t: Date.now() }));
        await redis.del(probe);
        canWrite = true;
      } catch (e: any) {
        canWrite = false; writeError = e?.message || String(e);
      }

      let indexIds: string[] = [];
      try { indexIds = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[]; }
      catch (e: any) { writeError ||= `zrange: ${e?.message || String(e)}`; }

      let keys: string[] = [];
      try { keys = await scanAll('campaigns:*'); } catch {}

      let sample: Any | null = null;
      if (indexIds?.[0]) {
        const raw = await redis.get<string>(ITEM_KEY(indexIds[0]));
        try { sample = raw ? JSON.parse(raw) : null; } catch { sample = raw as any; }
      }

      return NextResponse.json({
        ok: true,
        env, canWrite, writeError,
        indexCount: indexIds.length, indexIds,
        keysCount: keys.length, keys: keys.slice(0, 50),
        sample,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || 'DEBUG_FAILED' }, { status: 500 });
    }
  }

  // /api/campaigns/[id] → звичайне читання
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });
  const raw = await redis.get<string>(ITEM_KEY(id));
  if (!raw) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  try { return NextResponse.json({ ok: true, item: JSON.parse(raw) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ ok: false, error: 'CORRUPTED_ITEM' }, { status: 500 }); }
}

// ---------- PUT ----------
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

  const raw = await redis.get<string>(ITEM_KEY(id));
  if (!raw) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  const patch = (await req.json()) as Any;
  let item: Any; try { item = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: 'CORRUPTED_ITEM' }, { status: 500 }); }

  const updated = { ...item, ...patch, id, updated_at: Date.now(), name: (patch.name ?? item.name ?? '').toString().trim() };
  await redis.set(ITEM_KEY(id), JSON.stringify(updated));
  return NextResponse.json({ ok: true, item: updated });
}

// ---------- DELETE ----------
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

  await redis.del(ITEM_KEY(id));
  await redis.zrem(INDEX_KEY, id);

  return NextResponse.json({ ok: true });
}

// Безпечна відповідь на випадковий POST
export async function POST() {
  return NextResponse.json({ ok: false, error: 'UNSUPPORTED' }, { status: 400 });
}
