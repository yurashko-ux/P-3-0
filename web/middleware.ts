// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const ADMIN_LOGIN = '/admin/login';

// які шляхи перевіряємо
export const config = {
  matcher: ['/admin/:path*', '/api/campaigns/:path*'],
};

export default function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  const ADMIN = process.env.ADMIN_PASS || '';
  // зчитуємо токен з кукі
  let token = req.cookies.get('admin_token')?.value || '';

  // якщо прийшов ?token= — зберігаємо у куку і прибираємо з URL
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    token = tokenFromQuery;
    url.searchParams.delete('token');
    const res = NextResponse.redirect(url);
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  }

  // прокидуємо токен у заголовок для бекових роутів (щоб UI не додавав сам)
  const requestHeaders = new Headers(req.headers);
  if (token) requestHeaders.set('x-admin-token', token);

  // --- захист адмін-розділу ---
  const isAdminArea = pathname.startsWith('/admin');
  const isLoginPage = pathname === ADMIN_LOGIN;

  // якщо на сторінці логіну і вже авторизовані — редірект у /admin
  if (isAdminArea && isLoginPage && ADMIN && token === ADMIN) {
    const res = NextResponse.redirect(new URL('/admin', req.url));
    res.headers.set('x-from-mw', 'login-ok-redirect');
    return res;
  }

  // якщо це будь-яка адмін-сторінка (окрім /admin/login) — перевіряємо токен
  if (isAdminArea && !isLoginPage) {
    if (!ADMIN) {
      // щоб не застакатись без пароля у проді — показуємо логін
      return NextResponse.redirect(new URL(ADMIN_LOGIN, req.url));
    }
    if (token !== ADMIN) {
      return NextResponse.redirect(new URL(ADMIN_LOGIN, req.url));
    }
  }

  // передаємо далі, додаючи наші заголовки (з x-admin-token)
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return res;
}
