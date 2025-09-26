// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// важливо: це значення має бути задане у Vercel → Project → Settings → Environment Variables
const ADMIN_PASS = process.env.ADMIN_PASS || '';

/**
 * Правила:
 * - /admin/* доступні тільки якщо cookie admin_token (або admin/admin_pass) === ADMIN_PASS
 * - ?token=... у будь-якому URL автоматично зберігає кукі та чистить урл
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // 1) Обробка magic-параметра ?token=
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    const clean = url.clone();
    clean.searchParams.delete('token');

    const res = NextResponse.redirect(clean);
    // ставимо основний кукі
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
    // сумісність зі старими перевірками
    res.cookies.set('admin', tokenFromQuery, { path: '/', sameSite: 'lax' });
    res.cookies.set('admin_pass', tokenFromQuery, { path: '/', sameSite: 'lax' });
    return res;
  }

  // 2) Перевіряємо доступ лише до /admin/*
  const protectsAdmin = pathname.startsWith('/admin');

  if (!protectsAdmin) {
    // все інше пропускаємо
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

  // 4) Якщо не валідно — шлемо на /admin/login
  const loginUrl = url.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = ''; // без сміття
  return NextResponse.redirect(loginUrl);
}

/**
 * Matcher: захищаємо тільки /admin/*
 * (API й інші сторінки не чіпаємо, щоб нічого не зламати)
 */
export const config = {
  matcher: ['/admin/:path*'],
};
