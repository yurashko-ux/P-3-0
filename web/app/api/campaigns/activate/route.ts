// web/app/api/campaigns/activate/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// Ключі як у решті ендпоінтів
const ITEM_KEY = (id: string | number) => `campaigns:item:${id}`;

function unauthorized(msg = 'Unauthorized: missing or invalid admin token') {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 });
}

export async function POST(req: Request) {
  // Перевіряємо адмін-токен (заголовок або cookie)
  const adminHeader = req.headers.get('x-admin-token') || req.headers.get('X-Admin-Token');
  const adminCookie = (req.headers.get('cookie') || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('admin_token='))
    ?.split('=')[1];

  const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_TOKEN || '11111';
  if ((adminHeader || adminCookie) !== ADMIN_PASS) {
    return unauthorized();
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON body' }, { status: 400 });
  }

  const id = body?.id ?? body?.campaign_id ?? body?.campaignId;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing "id"' }, { status: 400 });
  }

  const desiredActive: boolean | undefined =
    typeof body?.active === 'boolean' ? body.active : undefined;

  // Читаємо поточний запис
  const raw = await redis.get(ITEM_KEY(id));
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  let item: any;
  try {
    item = JSON.parse(raw);
  } catch {
    // якщо колись записали рядком — зробимо з нього обʼєкт
    item = { name: String(raw) };
  }

  // Обчислюємо нове значення active: або з body, або toggle
  const nextActive =
    typeof desiredActive === 'boolean' ? desiredActive : !Boolean(item.active);

  const updated = { ...item, active: nextActive };

  // Зберігаємо назад
  await redis.set(ITEM_KEY(id), JSON.stringify(updated));

  // УВАГА: тут НІЯКОГО zadd — ми більше не торкаємось sorted set.
  // Індекс (список id) лишається як є; у більшості UI це ок.

  return NextResponse.json({
    ok: true,
    id,
    active: nextActive,
    item: updated,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
