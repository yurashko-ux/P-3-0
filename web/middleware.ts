// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // 1) Capture ?token=... → set cookie → redirect на /admin (домашня сторінка адмінки)
  const qToken = url.searchParams.get('token');
  if (qToken && qToken.trim()) {
    const dest = url.clone();
    dest.pathname = '/admin'; // <— головна адмінки
    dest.search = '';

    const res = NextResponse.redirect(dest);
    res.cookies.set('admin_token', qToken.trim(), {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: true,
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  }

  const cookieToken = req.cookies.get('admin_token')?.value || '';

  // 2) /admin/login: якщо вже є cookie — ведемо на /admin (а не на /admin/campaigns)
  if (pathname === '/admin/login') {
    if (cookieToken) {
      const dest = url.clone();
      dest.pathname = '/admin'; // <— головна адмінки
      dest.search = '';
      return NextResponse.redirect(dest);
    }
    return NextResponse.next();
  }

  // 3) інші /admin/* сторінки вимагають cookie
  if (!cookieToken) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  // 4) пропускаємо запит
  return NextResponse.next();
}
