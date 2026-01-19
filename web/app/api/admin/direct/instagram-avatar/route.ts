// web/app/api/admin/direct/instagram-avatar/route.ts
// Повертає аватарку Instagram (URL з KV) як redirect для відображення в адмін-таблиці.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usernameRaw = req.nextUrl.searchParams.get('username') || '';
    const normalized = normalizeInstagram(usernameRaw) || usernameRaw.trim().toLowerCase();
    if (!normalized) {
      return NextResponse.json({ ok: false, error: 'username missing' }, { status: 400 });
    }

    const raw = await kvRead.getRaw(directAvatarKey(normalized));
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const res = NextResponse.redirect(url, { status: 302 });
    // Кешуємо недовго, бо URL аватарок можуть змінюватись.
    res.headers.set('Cache-Control', 'private, max-age=300');
    return res;
  } catch (err) {
    console.error('[direct/instagram-avatar] ❌ Помилка:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

