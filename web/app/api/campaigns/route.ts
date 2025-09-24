// web/app/api/campaigns/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { redis } from '@/lib/redis';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY  = (id: string | number) => `campaigns:item:${id}`;

function readAdminToken(req: NextRequest) {
  // 1) заголовок
  const h = headers();
  const hToken = h.get('x-admin-token') || h.get('X-Admin-Token');

  // 2) query ?token=
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token');

  // 3) cookie
  const c = cookies();
  const cToken = c.get('admin_token')?.value;

  return hToken || qToken || cToken || '';
}

function isAllowed(token: string) {
  const pass = process.env.ADMIN_PASS || process.env.ADMIN_TOKEN || '';
  // якщо пароль не налаштовано — пускаємо всіх (зручно на dev)
  if (!pass) return true;
  return token && token === pass;
}

async function readIndex(): Promise<string[]> {
  // Пробуємо різні варіанти збереження індексу
  try {
    // ZSET (нові → старі)
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as unknown as string[];
    if (Array.isArray(ids) && ids.length) return ids;
  } catch {}

  try {
    // LIST
    const ids = (await redis.lrange(INDEX_KEY, 0, -1)) as unknown as string[];
    if (Array.isArray(ids) && ids.length) return ids;
  } catch {}

  try {
    // Плоский JSON-масив у GET
    const raw = (await redis.get(INDEX_KEY)) as unknown as string | null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch {}

  return [];
}

async function readMany(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const out: any[] = [];
  // mget може бути недоступний у деяких адаптерах — читаємо по одному
  for (const id of ids) {
    try {
      const raw = (await redis.get(ITEM_KEY(id))) as unknown as string | null;
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw));
      } catch {
        // якщо лежить не-JSON — просто скіп
      }
    } catch {
      // пропускаємо помилки по одному ключу
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const token = readAdminToken(req);
  if (!isAllowed(token)) {
    return new NextResponse('Unauthorized: missing or invalid admin token', { status: 401 });
  }

  try {
    const ids = await readIndex();
    const items = await readMany(ids);
    return NextResponse.json({ ok: true, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return new NextResponse(`KV error: ${e?.message || 'unknown'}`, { status: 500 });
  }
}
