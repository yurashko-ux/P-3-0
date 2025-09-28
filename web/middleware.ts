// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Правила:
 * - Доступ до /admin/* і /api/campaigns* тільки з валідною кукою admin_token.
 * - /admin/login та /api/auth/login пропускаємо без перевірки.
 * - Якщо в URL є ?token=..., middleware виставляє куку admin_token і редіректить на той самий шлях без query.
 * - Якщо токен невалідний —:
 *   - для сторінок /admin/* → редірект на /admin/login
 *   - для /api/campaigns* → 401 JSON
 */
export function middleware(req: NextRequest) {
  const url = new URL(req.url);

  // ⚙️ Єдиний "джерело правди" для пароля
  // (fallback '11111' лишаю для зручності, щоб не зламати ваш поточний флоу)
  const ADMIN = process.env.ADMIN_PASS || '11111';

  const pathname = url.pathname;

  // 1) Шляхи, що не потребують авторизації
  const publicPaths = new Set<string>([
    '/admin/login',
    '/login',
    '/api/auth/login',
  ]);
  if (
    publicPaths.has(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets') ||
    pathname === '/'
  ) {
    // але якщо є ?token=..., все одно поставимо куку і приберемо query
    const maybe = handleQueryToken(req, ADMIN);
    if (maybe) return maybe;
    return NextResponse.next();
  }

  // 2) Якщо є ?token=..., ставимо куку і редіректимо на чисту URL
  const tokenized = handleQueryToken(req, ADMIN);
  if (tokenized) return tokenized;

  // 3) Перевірка куки
  const token = req.cookies.get('admin_token')?.value || '';
  const isOk = typeof token === 'string' && token.length > 0 && token === ADMIN;

  // 4) Якщо все добре — пропускаємо
  if (isOk) {
    return NextResponse.next();
  }

  // 5) Інакше — блокуємо за правилами
  if (pathname.startsWith('/api/campaigns')) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: missing or invalid admin token' },
      { status: 401 }
    );
  }

  // Будь-які інші admin-сторінки — на логін
  if (pathname.startsWith('/admin')) {
    const loginURL = new URL('/admin/login', req.url);
    return NextResponse.redirect(loginURL);
  }

  // За замовчуванням — пропускаємо (неадмінські сторінки)
  return NextResponse.next();
}

/**
 * Якщо в URL прийшов ?token=..., виставляємо куку та редіректимо на чистий URL без query.
 * Повертає NextResponse або null.
 */
function handleQueryToken(req: NextRequest, ADMIN: string): NextResponse | null {
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (!tokenFromQuery) return null;

  // Ставимо куку (навіть якщо токен не валідний — далі перевірка все одно відсіче)
  const res = NextResponse.redirect(stripToken(url));
  res.cookies.set('admin_token', tokenFromQuery, {
    path: '/',
    httpOnly: false, // UI може читати і показувати стан
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}

/** Прибирає ?token=... з URL */
function stripToken(url: URL): URL {
  const clean = new URL(url.toString());
  clean.searchParams.delete('token');
  return clean;
}

// Де працює middleware
export const config = {
  matcher: [
    '/admin/:path*',      // усі адмін-сторінки
    '/api/campaigns',     // список
    '/api/campaigns/:path*', // CRUD
  ],
};
