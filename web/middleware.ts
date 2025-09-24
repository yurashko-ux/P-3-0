// web/middleware.ts
import { NextResponse, NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { nextUrl, cookies } = req;

  // Працюємо лише з нашими кампаніями
  const pathname = nextUrl.pathname;
  if (!pathname.startsWith('/api/campaigns')) {
    return NextResponse.next();
  }

  // 1) Витягуємо токен з cookie або ?token=...
  const tokenFromCookie = cookies.get('admin_token')?.value || '';
  const tokenFromQuery = nextUrl.searchParams.get('token') || '';
  const token = tokenFromCookie || tokenFromQuery;

  // 2) Пробросимо токен у заголовок X-Admin-Token
  const requestHeaders = new Headers(req.headers);
  if (token) requestHeaders.set('X-Admin-Token', token);

  // 3) Якщо прийшов ?token=..., збережемо його в cookie
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (tokenFromQuery) {
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      // ВАЖЛИВО: значення повинно бути в нижньому регістрі
      sameSite: 'lax',
      httpOnly: false,
      // на проді краще ввімкнути secure
      secure: true,
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });
  }

  return res;
}

// Обмеження застосування
export const config = {
  matcher: ['/api/campaigns/:path*'],
};
