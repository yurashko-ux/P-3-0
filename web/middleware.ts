// /web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Політика:
 * - /login → редірект на /admin/login
 * - /admin/login, /api/*, статика — ПРОХОДЯТЬ без перевірки
 * - інші /admin/** — ДОСТУП ТІЛЬКИ з валідним cookie admin_token === ADMIN_PASS
 */
export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const { pathname } = url;

  // 1) Канонізуємо шлях логіна
  if (pathname === '/login') {
    const to = new URL('/admin/login', req.url);
    to.search = url.search;
    return NextResponse.redirect(to);
  }

  // 2) Білий список
  if (
    pathname === '/admin/login' ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets') ||
    pathname.startsWith('/public')
  ) {
    return NextResponse.next();
  }

  // 3) Захист адмінки
  if (pathname.startsWith('/admin')) {
    const token =
      req.cookies.get('admin_token')?.value ||
      req.cookies.get('admin')?.value ||
      req.cookies.get('admin_pass')?.value; // сумісність

    const expected = process.env.ADMIN_PASS ?? '';

    if (!token || token !== expected) {
      const to = new URL('/admin/login', req.url);
      return NextResponse.redirect(to);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/admin/:path*'],
};
