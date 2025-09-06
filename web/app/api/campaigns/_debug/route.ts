// web/app/api/campaigns/_debug/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

type Any = Record<string, any>;

async function scanAllKeys(match: string, count = 200): Promise<string[]> {
  let cursor = 0;
  const acc: string[] = [];
  while (true) {
    // Upstash може повертати або масив [cursor, keys], або об’єкт { cursor, keys }
    const res: any = await (redis as any).scan(cursor, { match, count });
    const next = Array.isArray(res) ? Number(res[0]) : Number(res?.cursor ?? 0);
    const keys = Array.isArray(res) ? (res[1] as string[]) : ((res?.keys as string[]) ?? []);
    if (keys?.length) acc.push(...keys);
    cursor = next;
    if (!cursor) break;
  }
  return acc;
}

export async function GET() {
  const env = {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
  };

  let canWrite = false;
  let writeError = '';

  // Перевіримо індекс
  let indexIds: string[] = [];
  try {
    indexIds = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
  } catch (e: any) {
    writeError = `zrange_err: ${e?.message || String(e)}`;
  }

  // Перевіримо право на запис без торкання індексу
  try {
    const probe = `campaigns:__probe__:${Date.now()}`;
    await redis.set(probe, JSON.stringify({ t: Date.now() }));
    await redis.del(probe);
    canWrite = true;
  } catch (e: any) {
    canWrite = false;
    writeError = e?.message || String(e);
  }

  // Пошукаємо сирі ключі campaigns:* (щоб пересвідчитись, що записи створюються)
  let keys: string[] = [];
  try {
    keys = await scanAllKeys('campaigns:*');
  } catch {}

  // Спробуємо зчитати перший елемент з індексу (якщо є)
  let sample: Any | null = null;
  if (indexIds?.[0]) {
    const raw = await redis.get<string>(ITEM_KEY(indexIds[0]));
    try { sample = raw ? JSON.parse(raw) : null; } catch { sample = raw as any; }
  }

  return NextResponse.json({
    ok: true,
    env,
    canWrite,
    writeError,
    indexCount: indexIds.length,
    indexIds,
    keysCount: keys.length,
    keys: keys.slice(0, 50),
    sample,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
