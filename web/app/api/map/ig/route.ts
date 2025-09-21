// web/app/api/map/ig/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const KEY = (handle: string) => `kc:index:social:instagram:${handle}`;

/** Нормалізація IG-хендла: обрізаємо пробіли, знімаємо @, уніфікуємо регістр */
function normHandle(raw?: string | null) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const noAt = t.startsWith('@') ? t.slice(1) : t;
  return noAt.toLowerCase();
}

/**
 * GET /api/map/ig?handle=@name
 * Повертає { ok, handle, card_id } якщо знайдено
 */
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const url = new URL(req.url);
  const raw = url.searchParams.get('handle');
  const handle = normHandle(raw);
  if (!handle) {
    return NextResponse.json(
      { ok: false, error: 'Missing handle (?handle=...)' },
      { status: 400 }
    );
  }

  const cardId = await kvGet<string>(KEY(handle)).catch(() => null);
  return NextResponse.json({
    ok: true,
    handle,
    card_id: cardId ?? null,
  });
}

/**
 * POST /api/map/ig
 * Body: { handle: string, card_id: number|string }
 * Зберігає мапу IG-хендла на card_id
 */
export async function POST(req: NextRequest) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const handle = normHandle(body?.handle);
  const cardRaw = body?.card_id;

  if (!handle) {
    return NextResponse.json(
      { ok: false, error: 'handle is required' },
      { status: 400 }
    );
  }
  if (cardRaw === undefined || cardRaw === null || String(cardRaw).trim() === '') {
    return NextResponse.json(
      { ok: false, error: 'card_id is required' },
      { status: 400 }
    );
  }

  const card_id = String(cardRaw).trim();

  await kvSet(KEY(handle), card_id);

  return NextResponse.json({
    ok: true,
    saved: { handle, card_id },
  });
}
