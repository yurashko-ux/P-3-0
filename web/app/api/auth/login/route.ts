// web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function setAdminCookies(res: NextResponse, value: string) {
  // основний
  res.cookies.set('admin_token', value, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
  });
  // сумісність зі старими назвами (якщо десь у коді ще читається)
  res.cookies.set('admin', value, { path: '/', sameSite: 'lax' });
  res.cookies.set('admin_pass', value, { path: '/', sameSite: 'lax' });
}

// POST: приймаємо { token } або { password }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const token = (body?.token ?? body?.password ?? '').toString();

    if (!ADMIN_PASS) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_PASS is not set on server' },
        { status: 500 },
      );
    }

    if (!token || token !== ADMIN_PASS) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store');
    setAdminCookies(res, token);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'Unexpected error', detail: String(e?.message || e) },
      { status: 500 },
    );
  }
}

// GET: /api/auth/login?token=... — альтернативний спосіб (зручно для тесту)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';

  if (!ADMIN_PASS) {
    return NextResponse.json(
      { ok: false, error: 'ADMIN_PASS is not set on server' },
      { status: 500 },
    );
  }

  if (!token || token !== ADMIN_PASS) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set('Cache-Control', 'no-store');
  setAdminCookies(res, token);
  return res;
}

// DELETE: логаут — прибираємо куки
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('admin_token');
  res.cookies.delete('admin');
  res.cookies.delete('admin_pass');
  return res;
}
