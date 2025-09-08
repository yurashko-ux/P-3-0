// web/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Доступ до /admin/*:
 *  - дозволяємо, якщо cookie "admin=1" (старий механізм) АБО
 *  - якщо cookie "admin_pass" збігається з ADMIN_PASS (новий механізм).
 *  - /admin/login завжди дозволено.
 *  - Якщо ADMIN_PASS порожній у ENV — не блокуємо (щоб не зачинити доступ випадково).
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // сторінка логіну без перевірок
  if (pathname === '/admin/login') return NextResponse.next();

  const envPass = process.env.ADMIN_PASS?.trim();
  const cookieAdmin = req.cookies.get('admin')?.value; // старий флаг
  const cookiePass = req.cookies.get('admin_pass')?.value?.trim(); // новий

  // якщо пароля в ENV нема — пускаємо всіх (режим налаштування)
  if (!envPass) return NextResponse.next();

  // приймаємо або старий, або новий механізм
  const allowed = cookieAdmin === '1' || (cookiePass && cookiePass === envPass);
  if (allowed) return NextResponse.next();

  // редіректимо на логін зі збереженням next
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  const next = pathname + (search || '');
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*'],
};
