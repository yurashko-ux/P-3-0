// web/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // 1) з URL: ?token=... | ?admin=... | ?admin_token=...
  const tokenFromQuery =
    url.searchParams.get('token') ||
    url.searchParams.get('admin') ||
    url.searchParams.get('admin_token') ||
    '';

  // 2) з cookie
  const tokenFromCookie = req.cookies.get('admin_token')?.value || '';

  // якщо прийшов токен у query — одразу збережемо його в cookie
  const res = NextResponse.next();
  if (tokenFromQuery) {
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'lax', // важливо: саме нижнім регістром
      httpOnly: false,
    });
  }

  const token = tokenFromQuery || tokenFromCookie;

  // 3) якщо маємо токен — прокинемо його у заголовок для бекенду
  if (token) {
    res.headers.set('x-admin-token', token);
  }

  return res;
}

// застосовуємо для всіх API та адмін-сторінок
export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
};
