// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ⛳️ Захищаємо лише адмін-роути
export const config = {
  matcher: ['/admin/:path*'],
};

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // 1) Якщо прийшли з ?token=..., ставимо кукі та чистимо URL
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery && tokenFromQuery.trim().length > 0) {
    // чистий URL без токена
    const clean = new URL(url);
    clean.searchParams.delete('token');

    // редіректимо на чистий URL і виставляємо кукі
    const res = NextResponse.redirect(clean);
    res.cookies.set('admin_token', tokenFromQuery.trim(), {
      path: '/',
      sameSite: 'lax', // важливо: нижній регістр
      httpOnly: false, // можна читати на клієнті, нам це ок
      secure: true,
    });
    return res;
  }

  // 2) Читаємо кукі
  const cookieToken = req.cookies.get('admin_token')?.value || '';

  // 3) Якщо ми на сторінці логіну — пускаємо завжди (щоб уника́ти циклу)
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  // 4) Якщо немає токена — редірект на логін
  if (!cookieToken) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.search = ''; // без зайвих параметрів
    return NextResponse.redirect(loginUrl);
  }

  // 5) Інакше все гаразд — пускаємо далі
  return NextResponse.next();
}
