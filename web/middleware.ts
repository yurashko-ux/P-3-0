// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  const ADMIN_PASS = process.env.ADMIN_PASS || '';

  // 1) Якщо це логін-сторінка — дозволяємо, але обробляємо ?token=
  if (pathname === '/admin/login') {
    const qToken = url.searchParams.get('token');
    if (qToken !== null) {
      const token = (qToken || '').trim();

      // Перевіряємо лише на повний збіг з ADMIN_PASS
      if (ADMIN_PASS && token === ADMIN_PASS) {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        clean.searchParams.delete('err');

        const res = NextResponse.redirect(clean);
        res.cookies.set('admin_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: true,
          maxAge: 60 * 60 * 24 * 7, // 7d
        });
        return res;
      } else {
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', '1');
        const res = NextResponse.redirect(back);
        // на всяк випадок стираємо невірну куку
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }
    // просто віддати сторінку логіну
    return NextResponse.next();
  }

  // 2) Для всіх інших /admin/* — має бути валідна кука
  const cookieToken = req.cookies.get('admin_token')?.value || '';
  const isOk = ADMIN_PASS && cookieToken === ADMIN_PASS;

  if (!isOk) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', '1'); // підказка на UI
    return NextResponse.redirect(loginUrl);
  }

  // 3) Все гаразд — пропускаємо запит
  return NextResponse.next();
}
