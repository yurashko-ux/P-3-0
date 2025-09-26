// web/app/api/auth/set/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Body = { token?: string; logout?: boolean };

export async function POST(req: Request) {
  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (!ADMIN_PASS) {
    return NextResponse.json(
      { ok: false, error: 'Server misconfigured: ADMIN_PASS is missing' },
      { status: 500 }
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // ignore; will fail validation below
  }

  // Вихід із системи: видаляємо куку
  if (body.logout) {
    const res = NextResponse.json({ ok: true, logout: true });
    res.cookies.set('admin_token', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 0, // expire immediately
    });
    return res;
  }

  const token = (body.token || '').trim();

  // Жорстка перевірка токена
  if (!token || token !== ADMIN_PASS) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: bad token' },
      { status: 401 }
    );
  }

  // Успішна авторизація: виставляємо httpOnly cookie
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}
