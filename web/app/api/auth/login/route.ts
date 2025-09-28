// web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function ok<T>(data: T, setCookie?: { name: string; value: string }) {
  const res = NextResponse.json({ ok: true, ...((data as any) || {}) });
  if (setCookie) {
    res.cookies.set(setCookie.name, setCookie.value, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // дозволяємо читати на клієнті (для простоти UI)
    });
  }
  // вимикаємо кеш
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function fail(status: number, error: string) {
  const res = NextResponse.json({ ok: false, error }, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// POST /api/auth/login  { password?: string, token?: string }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const password: string =
      body?.password ?? body?.token ?? req.headers.get('x-admin-token') ?? '';

    if (!ADMIN_PASS) {
      return fail(500, 'ADMIN_PASS is not configured in environment');
    }

    if (password !== ADMIN_PASS) {
      return fail(401, 'Invalid password');
    }

    return ok({ user: 'admin' }, { name: 'admin_token', value: ADMIN_PASS });
  } catch (e: any) {
    return fail(500, 'Unexpected error');
  }
}

// GET /api/auth/login → перевірка статусу
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token =
    // 1) query ?token=...
    url.searchParams.get('token') ||
    // 2) header
    (typeof Headers !== 'undefined'
      ? new Headers(req.headers).get('x-admin-token')
      : null) ||
    // 3) cookie admin_token=...
    (() => {
      const cookie = (req.headers.get('cookie') || '')
        .split(';')
        .map((s) => s.trim());
      const kv = Object.fromEntries(
        cookie
          .map((c) => {
            const i = c.indexOf('=');
            return i >= 0 ? [c.slice(0, i), decodeURIComponent(c.slice(i + 1))] : [c, ''];
          })
      );
      return kv['admin_token'] || null;
    })();

  if (!ADMIN_PASS) {
    return fail(500, 'ADMIN_PASS is not configured in environment');
  }

  if (token === ADMIN_PASS) {
    return ok({ authed: true });
  }
  return fail(401, 'Not authenticated');
}
