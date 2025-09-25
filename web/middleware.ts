// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // джерела токена
  const tokenFromQuery = url.searchParams.get('token')?.trim() || '';
  const tokenFromCookie = req.cookies.get('admin_token')?.value?.trim() || '';
  const tokenFromHeader = req.headers.get('x-admin-token')?.trim() || '';

  // якщо токен прийшов у query → кладемо в кукі та редіректимо на чисту URL без ?token
  if (tokenFromQuery) {
    const clean = new URL(url);
    clean.searchParams.delete('token');

    const res = NextResponse.redirect(clean);

    // IMPORTANT: типи Next 14 очікують 'lax' у нижньому регістрі
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });

    // на випадок негайних внутрішніх фетчів:
    res.headers.set('x-admin-token', tokenFromQuery);
    return res;
  }

  // інакше прокидаємо токен у заголовок для всіх запитів
  const effectiveToken = tokenFromHeader || tokenFromCookie;
  const requestHeaders = new Headers(req.headers);
  if (effectiveToken) {
    requestHeaders.set('x-admin-token', effectiveToken);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// застосовуємо до всього, крім статичних ресурсів
export const config = {
  matcher: ['/((?!_next|static|favicon.ico|robots.txt|sitemap.xml).*)'],
};
