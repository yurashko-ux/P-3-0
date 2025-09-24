// web/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // 1) токен із query (?token=... | ?admin=... | ?admin_token=...)
  const tokenFromQuery =
    url.searchParams.get('token') ||
    url.searchParams.get('admin') ||
    url.searchParams.get('admin_token') ||
    '';

  // 2) токен із cookie
  const tokenFromCookie = req.cookies.get('admin_token')?.value || '';

  // 3) фінальний токен
  const token = tokenFromQuery || tokenFromCookie || '';

  // 4) сформуємо нові заголовки ЗАПИТУ до хендлерів (важливо!)
  const requestHeaders = new Headers(req.headers);
  if (token) {
    requestHeaders.set('x-admin-token', token);
  }

  // 5) пропускаємо далі з модифікованими заголовками запиту
  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // 6) якщо був токен у query — збережемо в cookie, щоб не тягнути в URL
  if (tokenFromQuery) {
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
  }

  return res;
}

// застосувати і до API, і до адмін-роутів
export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
};
