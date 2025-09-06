// web/app/admin/login/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const adminPass = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();
  if (!adminPass) {
    return NextResponse.redirect(new URL('/admin/login?err=env', req.url));
  }

  const form = await req.formData().catch(() => null);
  const input = String(form?.get('password') || '').trim();

  if (input && input === adminPass) {
    const res = NextResponse.redirect(new URL('/admin', req.url));
    res.cookies.set('admin_ok', '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  return NextResponse.redirect(new URL('/admin/login?err=1', req.url));
}
