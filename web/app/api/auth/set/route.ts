// web/app/api/auth/set/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/set?token=YOUR_ADMIN_PASS
 * - якщо token передано — встановлюємо cookie admin_token
 * - якщо token порожній — видаляємо cookie
 * - після цього редірект на /admin/campaigns
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';

  const redirectTo = url.searchParams.get('to') || '/admin/campaigns';
  const res = NextResponse.redirect(new URL(redirectTo, req.url));

  if (token) {
    res.cookies.set('admin_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 днів
    });
  } else {
    res.cookies.delete('admin_token', { path: '/' });
  }

  return res;
}
