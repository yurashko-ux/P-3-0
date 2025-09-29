// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const ADMIN_PASS = process.env.ADMIN_PASS || '';

  // Якщо не налаштовано ADMIN_PASS — блокуємо вхід із підказкою
  if (!ADMIN_PASS) {
    const res = NextResponse.json(
      { ok: false, error: 'ADMIN_PASS env is not set' },
      { status: 500 }
    );
    return res;
  }

  // /admin/login — обробляємо ?token=
  if (pathname === '/admin/login') {
    const qToken = url.searchParams.get('token');
    if (qToken !== null) {
      const token = (qToken || '').trim();
      const clean = new URL(url);
      clean.searchParams.delete('token');
      clean.searchParams.delete('err');

      if (token === ADMIN_PASS) {
        const res = NextResponse.redirect(clean);
        res.cookies.set('admin_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: true,
          maxAge: 60 * 60 * 24 * 7,
        });
        return res;
      } else {
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', '1');
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }
    return NextResponse.next();
  }

  // /admin/logout — стираємо куку і ведемо на логін
  if (pathname === '/admin/logout') {
    const back = url.clone();
    back.pathname = '/admin/login';
    back.search = '';
    const res = NextResponse.redirect(back);
    res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
    return res;
  }

  // Інші /admin/* — потрібна валідна кука
  const cookieToken = req.cookies.get('admin_token')?.value || '';
  if (cookieToken !== ADMIN_PASS) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', '1');
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
