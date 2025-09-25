// web/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // 1) Зчитуємо токен з query (?token=...), cookie або заголовка
  const tokenFromQuery = url.searchParams.get('token')?.trim() || '';
  const tokenFromCookie = req.cookies.get('admin_token')?.value?.trim() || '';
  const tokenFromHeader = req.headers.get('x-admin-token')?.trim() || '';

  // 2) Поточні хедери запиту, щоб можна було додати X-Admin-Token
  const requestHeaders = new Headers(req.headers);

  // 3) Якщо токен прийшов у query — зберігаємо у cookie і підставляємо в запит
  if (tokenFromQuery) {
    const res = NextResponse.redirect(() => {
      const clean = new URL(url);
      clean.searchParams.delete('token');
      return clean;
    }());

    // ставимо кукі
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });

    // і одразу додаємо заголовок для наступного запиту після редіректу
    res.headers.set('x-admin-token', tokenFromQuery);
    return res;
  }

  // 4) Якщо в кукі вже є токен — прокидаємо його як заголовок у КОЖЕН запит
  const effectiveToken = tokenFromHeader || tokenFromCookie;
  if (effectiveToken) {
    requestHeaders.set('x-admin-token', effectiveToken);
  }

  // 5) Пропускаємо запит далі з оновленими хедерами
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Поширюємо на всі шляхи, окрім статичних
export const config = {
  matcher: [
    '/((?!_next|static|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
