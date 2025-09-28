// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function readCookie(req: NextRequest, name: string): string | null {
  const raw = req.cookies.get(name)?.value;
  return raw ? decodeURIComponent(raw) : null;
}

function isAuthed(req: NextRequest): boolean {
  const cookieToken = readCookie(req, 'admin_token') || '';
  const headerToken = req.headers.get('x-admin-token') || '';
  const token = cookieToken || headerToken;
  return Boolean(ADMIN_PASS && token && token === ADMIN_PASS);
}

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // пропускаємо все, що не /admin/*
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // /admin/login завжди дозволений (щоб не було циклів)
  const isLoginPage = pathname === '/admin/login';

  // якщо прийшов ?token=..., зберігаємо в куку і чистимо URL
  const tokenFromQuery = searchParams.get('token');
  if (tokenFromQuery) {
    const res = NextResponse.redirect(
      new URL(pathname, req.url) // редірект на ту ж сторінку без query
    );
    res.cookies.set('admin_token', tokenFromQuery, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
    return res;
  }

  // якщо вже авторизований — пропускаємо
  if (isAuthed(req)) {
    return NextResponse.next();
  }

  // неавторизований:
  // - якщо вже на /admin/login → показуємо сторінку логіну
  // - інакше редіректимо на /admin/login
  if (isLoginPage) {
    return NextResponse.next();
  }

  const to = new URL('/admin/login', req.url);
  return NextResponse.redirect(to);
}

export const config = {
  matcher: [
    // захищаємо всі admin-шляхи, але статичні та api поза /admin чіпати не треба
    '/admin/:path*',
  ],
};
