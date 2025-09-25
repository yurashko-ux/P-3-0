// web/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const tokenFromQuery = url.searchParams.get('token');

  // Базова відповідь (пропускаємо запит далі)
  const res = NextResponse.next();

  if (tokenFromQuery && tokenFromQuery.trim()) {
    // Ставимо cookie з адмін-токеном
    res.cookies.set('admin_token', tokenFromQuery.trim(), {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });

    // Прибираємо токен з адресного рядка
    const clean = new URL(url);
    clean.searchParams.delete('token');

    // Повертаємо редірект БЕЗ параметра token і ЗІ встановленим cookie
    return NextResponse.redirect(clean, {
      headers: res.headers,
    });
  }

  return res;
}

// Працюємо скрізь: як мінімум /admin та /api нам потрібні.
// Якщо хочеш обмежити — залиш "/admin/:path*" і "/api/:path*".
export const config = {
  matcher: [
    '/((?!_next|static|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
