// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const ADMIN_PASS = process.env.ADMIN_PASS || '';

  // 1) /admin/logout — очистити сесію і на логін
  if (pathname === '/admin/logout') {
    const back = url.clone();
    back.pathname = '/admin/login';
    back.search = '';
    const res = NextResponse.redirect(back);
    res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
    return res;
  }

  // 2) /admin/login — показуємо сторінку, але обробляємо ?token=
  if (pathname === '/admin/login') {
    const qToken = url.searchParams.get('token');
    if (qToken !== null) {
      const token = (qToken || '').trim();

      // якщо ADMIN_PASS не заданий — не пускаємо, просимо адміна виставити змінну
      if (!ADMIN_PASS) {
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', 'env'); // немає ADMIN_PASS у середовищі
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }

      // звичайний точний збіг
      const cleanDest = new URL(url);
      cleanDest.pathname = '/admin';          // після логіну одразу на домашню сторінку адмінки
      cleanDest.search = '';

      if (token === ADMIN_PASS) {
        const res = NextResponse.redirect(cleanDest);
        res.cookies.set('admin_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: true,
          maxAge: 60 * 60 * 24 * 7, // 7 днів
        });
        return res;
      } else {
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', '1'); // невірний токен
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }
    // просто віддати сторінку логіну
    return NextResponse.next();
  }

  // 3) Усі інші /admin/* — потрібен заданий ADMIN_PASS і валідна кука
  if (!ADMIN_PASS) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', 'env'); // підказка що нема ADMIN_PASS
    return NextResponse.redirect(loginUrl);
  }

  const cookieToken = req.cookies.get('admin_token')?.value || '';
  if (cookieToken !== ADMIN_PASS) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', '1'); // невірний або відсутній токен
    return NextResponse.redirect(loginUrl);
  }

  // все гаразд
  return NextResponse.next();
}
