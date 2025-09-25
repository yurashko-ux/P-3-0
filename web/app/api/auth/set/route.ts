// web/app/api/auth/set/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function envAdminPass() {
  const v = process.env.ADMIN_PASS ?? '';
  return String(v).trim();
}

export async function POST(req: Request) {
  let token: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    token = typeof body?.token === 'string' ? body.token.trim() : undefined;
  } catch {
    // ignore
  }

  const ADMIN = envAdminPass();
  const resOk = () =>
    NextResponse.json({ ok: true, message: 'Token accepted' }, { status: 200 });
  const resBad = (msg = 'Invalid admin token') =>
    NextResponse.json({ ok: false, error: msg }, { status: 401 });

  // якщо ENV не задано — краще нікого не пускати
  if (!ADMIN) {
    const res = resBad('ADMIN_PASS env not configured');
    // прибираємо потенційно стару куку
    (res as any).cookies?.delete?.('admin_token');
    return res;
  }

  if (!token) {
    const res = resBad('Missing token');
    (res as any).cookies?.delete?.('admin_token');
    return res;
  }

  if (token !== ADMIN) {
    const res = resBad('Invalid admin token');
    (res as any).cookies?.delete?.('admin_token');
    return res;
  }

  // валідний токен → ставимо куку
  const res = resOk();
  // httpOnly залишаємо false, бо UI читає document.cookie
  res.cookies.set('admin_token', token, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 7, // 7 днів
    secure: true,
  });
  return res;
}

// опціонально: GET для швидкої перевірки статусу
export async function GET() {
  const message = envAdminPass() ? 'Auth API ready' : 'ADMIN_PASS not set';
  return NextResponse.json({ ok: true, message });
}
