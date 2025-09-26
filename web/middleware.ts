// web/middleware.ts
import { NextResponse, NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Дозволяємо сторінку логіну без перевірки
  if (pathname === '/login' || pathname === '/api/auth/set') {
    return NextResponse.next();
  }

  // Читаємо токен з httpOnly-куки
  const cookieToken = req.cookies.get('admin_token')?.value || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';

  // Якщо токен відсутній або не збігається — редірект на /login
  if (!cookieToken || cookieToken !== ADMIN_PASS) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // передамо, куди повертатися після логіну
    url.search = search || '';
    return NextResponse.redirect(url);
  }

  // Інакше пропускаємо
  return NextResponse.next();
}

// Застосовуємо тільки до /admin маршрутів
export const config = {
  matcher: ['/admin/:path*'],
};
