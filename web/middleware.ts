// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // 1) Capture ?token=... → set cookie → redirect to the same path без токена
  const qToken = url.searchParams.get('token');
  if (qToken && qToken.trim()) {
    const clean = url.clone();
    clean.searchParams.delete('token');

    const res = NextResponse.redirect(clean);
    res.cookies.set('admin_token', qToken.trim(), {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,       // we want client to read it for server actions if needed
      secure: true,          // required on vercel.app (https)
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }

  const cookieToken = req.cookies.get('admin_token')?.value || '';

  // 2) Allow login page, but якщо cookie вже є — веземо одразу в /admin/campaigns
  if (pathname === '/admin/login') {
    if (cookieToken) {
      const dest = url.clone();
      dest.pathname = '/admin/campaigns';
      dest.search = '';
      return NextResponse.redirect(dest);
    }
    return NextResponse.next();
  }

  // 3) Інші /admin/* шляхи вимагають cookie
  if (!cookieToken) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  // 4) Пропускаємо запит
  return NextResponse.next();
}
