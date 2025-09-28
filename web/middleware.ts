// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const ADMIN_PREFIX = '/admin';
const LOGIN_PATH = '/admin/login';
const ADMIN_PASS = process.env.ADMIN_PASS || '11111';

export function middleware(req: NextRequest) {
  const { pathname, searchParams, origin } = req.nextUrl;

  // 1) Поза /admin — нічого не робимо
  if (!pathname.startsWith(ADMIN_PREFIX)) {
    return NextResponse.next();
  }

  // 2) Дозволяємо бачити сторінку логіну без перевірок
  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  // 3) Якщо прийшов ?token=..., ставимо кукі та редіректимо на той самий шлях без query
  const tokenFromQuery = searchParams.get('token');
  if (tokenFromQuery) {
    const clean = new URL(pathname, origin); // той самий шлях, але без параметрів
    const res = NextResponse.redirect(clean);
    res.cookies.set({
      name: 'admin_token',
      value: tokenFromQuery,
      path: '/',
      // httpOnly:false щоб клієнтські сторінки могли читати при потребі
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 днів
    });
    return res;
  }

  // 4) Перевіряємо кукі
  const tokenFromCookie = req.cookies.get('admin_token')?.value;
  if (tokenFromCookie === ADMIN_PASS) {
    return NextResponse.next();
  }

  // 5) Якщо токена немає/хибний — ведемо на логін
  const toLogin = new URL(LOGIN_PATH, origin);
  return NextResponse.redirect(toLogin);
}

export const config = {
  // Перехоплюємо ТІЛЬКИ адмін-маршрути
  matcher: [`${ADMIN_PREFIX}/:path*`],
};
