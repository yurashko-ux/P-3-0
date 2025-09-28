// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Значення має бути налаштоване у Vercel → Project → Settings → Environment Variables
const ADMIN_PASS = process.env.ADMIN_PASS || '';

/**
 * Правила доступу:
 * - /admin/login (та /admin/logout) — завжди дозволено (щоб не було редирект-лупа)
 * - всі інші /admin/* — тільки з валідним admin_token (або admin/admin_pass) == ADMIN_PASS
 * - ?token=... у будь-якому URL ставить кукі та чистить URL
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // 0) Якщо є ?token=..., ставимо кукі та чистимо URL
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    const clean = url.clone();
    clean.searchParams.delete('token');

    const res = NextResponse.redirect(clean);

    // основний кукі
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });

    // сумісність зі старими назвами
    res.cookies.set('admin', tokenFromQuery, { path: '/', sameSite: 'lax' });
    res.cookies.set('admin_pass', tokenFromQuery, { path: '/', sameSite: 'lax' });

    return res;
  }

  // 1) Захищаємо лише /admin/*
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // 2) Дозволені винятки (щоб не було ERR_TOO_MANY_REDIRECTS)
  if (pathname === '/admin/login' || pathname === '/admin/logout') {
    return NextResponse.next();
  }

  // 3) Зчитуємо кукі
  const cookieToken =
    req.cookies.get('admin_token')?.value ||
    req.cookies.get('admin')?.value ||
    req.cookies.get('admin_pass')?.value;

  const isValid = Boolean(ADMIN_PASS) && cookieToken === ADMIN_PASS;

  if (isValid) {
    return NextResponse.next();
  }

  // 4) Якщо токен невалідний — відправляємо на форму логіну
  const loginUrl = url.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = ''; // без параметрів
  return NextResponse.redirect(loginUrl);
}

// Перехоплюємо тільки /admin/*
export const config = {
  matcher: ['/admin/:path*'],
};
