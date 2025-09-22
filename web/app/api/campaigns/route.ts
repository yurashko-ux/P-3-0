// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

// ---- auth: приймаємо токен з query, cookie, або Authorization: Bearer
function readToken(req: NextRequest): string {
  // 1) ?token=...
  const fromQuery = (req.nextUrl.searchParams.get('token') || '').trim();
  if (fromQuery) return fromQuery;

  // 2) cookie=admin_token
  const fromCookie = (req.cookies.get('admin_token')?.value || '').trim();
  if (fromCookie) return fromCookie;

  // 3) Authorization: Bearer XXX
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();

  return '';
}

function unauthorized(msg = 'Unauthorized: missing or invalid admin token') {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const token = readToken(req);
  const expected = (process.env.ADMIN_TOKEN || '').trim();

  if (expected) {
    if (!token || token !== expected) {
      return unauthorized();
    }
  }
  // якщо ADMIN_TOKEN не задано в env — проходимо без перевірки

  // тягнемо ids з індексу
  let ids: string[] = [];
  try {
    // наш redis-адаптер підтримує { rev: true }
    ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as unknown as string[];
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // підвантажуємо кожен item окремо (без mget)
  const items: any[] = [];
  for (const id of ids || []) {
    try {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        items.push(JSON.parse(raw));
      } catch {
        // якщо це не JSON — повернемо як рядок
        items.push({ id, name: String(raw) });
      }
    } catch {
      // пропускаємо зламані елементи
    }
  }

  return NextResponse.json(
    { ok: true, count: items.length, items },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// опційно — щоб не лякати preflight у деяких браузерів/розширень
export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
