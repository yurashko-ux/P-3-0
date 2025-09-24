// web/middleware.ts
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Ловить ?token=... і зберігає його у cookie `admin_token`,
 * після чого робить редірект на ту ж URL без параметра.
 *
 * Використання:
 *   https://p-3-0.vercel.app/admin/campaigns?token=11111
 *   або
 *   https://p-3-0.vercel.app/admin/campaigns/new?token=11111
 */

export function middleware(req: NextRequest) {
  const url = new URL(req.url)
  const tokenFromQuery = url.searchParams.get('token')

  // Пропускаємо запит далі за замовчуванням
  const res = NextResponse.next()

  if (tokenFromQuery !== null) {
    if (tokenFromQuery === '' || tokenFromQuery === '0') {
      // Видалити токен
      res.cookies.delete('admin_token')
    } else {
      // Зберегти токен
      res.cookies.set('admin_token', tokenFromQuery, {
        path: '/',
        sameSite: 'lax',   // важливо: нижній регістр для типів Next 14
        httpOnly: false,   // щоб клієнтський код міг читати при потребі
      })
    }

    // Прибрати ?token з адресного рядка
    url.searchParams.delete('token')
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/:path*', // дозволяє теж передати ?token=... прямо в API, якщо треба
  ],
}
