// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string | number) => `campaigns:item:${id}`;

// ---- helpers
function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  const rx = new RegExp('(?:^|;\\s*)' + name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&') + '=([^;]*)');
  const m = raw.match(rx);
  return m ? decodeURIComponent(m[1]) : null;
}

function isAdmin(req: Request): boolean {
  const hdr = req.headers.get('x-admin-token') || '';
  const ck = readCookie(req.headers, 'admin_token') || '';
  const pass = process.env.ADMIN_PASS || '11111';
  return hdr === pass || ck === pass;
}

// ---- GET /api/campaigns  -> список кампаній (нові зверху)
export async function GET() {
  // Читаємо всі id з list-індексу
  const ids: string[] = await redis.lrange(INDEX_KEY, 0, -1).catch(() => []);

  const items: any[] = [];
  for (const id of ids) {
    const raw = await redis.get(ITEM_KEY(id)).catch(() => null);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      items.push({ id, ...obj });
    } catch {
      // ігноруємо биті записи
    }
  }

  return NextResponse.json(
    { ok: true, count: items.length, items },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// ---- POST /api/campaigns  -> створення кампанії
export async function POST(req: Request) {
  if (!isAdmin(req)) {
    return new NextResponse('Unauthorized: missing or invalid admin token', { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const now = Date.now();
  const id = String(now);

  const item = {
    name: body.name ?? 'New campaign',
    created_at: now,
    active: true,
    base_pipeline_id: body.base_pipeline_id ?? null,
    base_status_id: body.base_status_id ?? null,
    base_pipeline_name: body.base_pipeline_name ?? null,
    base_status_name: body.base_status_name ?? null,
    rules: {
      v1: {
        op: body?.rules?.v1?.op ?? 'contains',
        value: body?.rules?.v1?.value ?? '',
      },
      v2: {
        op: body?.rules?.v2?.op ?? 'contains',
        value: body?.rules?.v2?.value ?? '',
      },
    },
    exp: body.exp ?? {},
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // Зберігаємо сам об’єкт і оновлюємо list-індекс (нові зверху)
  const setRes = await redis.set(ITEM_KEY(id), JSON.stringify(item));
  await redis.lpush(INDEX_KEY, id);

  return NextResponse.json(
    { ok: true, id, setRes: { result: setRes }, item },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
