// web/middleware.ts
import { NextResponse, NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { nextUrl, cookies } = req;

  // Працюємо лише для admin-кампанійних API
  // (можна розширити список шляхів у matcher нижче)
  const pathname = nextUrl.pathname;
  if (!pathname.startsWith('/api/campaigns')) {
    return NextResponse.next();
  }

  // 1) Дістаємо токен з cookie або з рядка запиту (?token=...)
  const tokenFromCookie = cookies.get('admin_token')?.value || '';
  const tokenFromQuery = nextUrl.searchParams.get('token') || '';
  const token = tokenFromCookie || tokenFromQuery;

  // 2) Пробросимо токен у заголовок запиту X-Admin-Token
  const requestHeaders = new Headers(req.headers);
  if (token) {
    requestHeaders.set('X-Admin-Token', token);
  }

  // 3) Якщо токен прийшов через ?token=..., одночасно збережемо його в cookie
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (tokenFromQuery) {
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'Lax',
      httpOnly: false,
    });
  }

  return res;
}

// Обмежуємо middleware тільки потрібними маршрутами
export const config = {
  matcher: ['/api/campaigns/:path*'],
};
