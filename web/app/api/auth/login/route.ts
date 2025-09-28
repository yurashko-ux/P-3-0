// web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

function bad(msg: string, status = 401) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  // приймаємо або { password }, або { token }
  const input = String(body?.password ?? body?.token ?? '');
  const ADMIN = process.env.ADMIN_PASS ?? '';

  if (!ADMIN) {
    return bad('ADMIN_PASS is not configured on server', 500);
  }
  if (!input) {
    return bad('Password is required');
  }
  if (input !== ADMIN) {
    return bad('Invalid password');
  }

  // OK → ставимо cookie admin_token
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_token', input, {
    path: '/',
    httpOnly: false, // можна true, якщо форма не читає куку з JS
    secure: true,
    sameSite: 'lax', // важливо: саме 'lax' (нижній регістр)
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}

// Корисно для перевірки стану (не обов’язково)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookie = (req as any)?.headers?.get('cookie') ?? '';
  const ADMIN = process.env.ADMIN_PASS ?? '';
  const has =
    cookie
      .split(/;\s*/g)
      .map((p: string) => p.split('='))[0] !== undefined &&
    cookie.includes(`admin_token=${ADMIN}`);

  return NextResponse.json({ ok: true, authenticated: has });
}
