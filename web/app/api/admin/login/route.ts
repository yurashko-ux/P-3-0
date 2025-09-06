// web/app/api/admin/login/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Якщо відкрили API напряму — ведемо на форму логіну
  return NextResponse.redirect(new URL('/admin/login', req.url));
}

export async function POST(req: Request) {
  const adminPass = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();
  if (!adminPass) {
    return NextResponse.redirect(new URL('/admin/login?err=env', req.url));
  }

  let input = '';
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      input = String((body as any)?.password ?? '').trim();
    } else {
      const form = await req.formData().catch(() => null);
      input = String(form?.get('password') ?? '').trim();
    }
  } catch {}

  if (input && input === adminPass) {
    const res = NextResponse.redirect(new URL('/admin', req.url));
    res.cookies.set('admin_ok', '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });
    return res;
  }

  return NextResponse.redirect(new URL('/admin/login?err=1', req.url));
}
