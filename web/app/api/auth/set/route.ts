// web/app/api/auth/set/route.ts
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'admin_token';

// без кешу на edge
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (token) {
    // дозволяємо ?token=... як швидкий спосіб логіну
    return await setToken(token);
  }

  // просто перевірка стану
  const hasCookie = req.headers.get('cookie')?.includes(`${COOKIE_NAME}=`) ?? false;
  return NextResponse.json({ ok: true, authed: hasCookie });
}

export async function POST(req: Request) {
  const body = await safeJson(req);
  const token = (body?.token ?? '').toString();
  return await setToken(token);
}

async function setToken(token: string) {
  const PASS = process.env.ADMIN_PASS ?? '';
  const ok = token && PASS && token === PASS;

  const res = NextResponse.json(
    ok
      ? { ok: true, message: 'Authenticated' }
      : { ok: false, error: 'Unauthorized: invalid admin token' },
    { status: ok ? 200 : 401 }
  );

  // якщо валідний — ставимо захищене кукі, інакше — видаляємо
  if (ok) {
    res.cookies.set(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });
  } else {
    // важливо: без додаткових аргументів — інакше Next 14 лається типами
    res.cookies.delete(COOKIE_NAME);
  }

  return res;
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
