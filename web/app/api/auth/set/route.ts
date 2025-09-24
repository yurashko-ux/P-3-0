// web/app/api/auth/set/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim();

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing ?token=...' },
      { status: 400 }
    );
  }

  const res = NextResponse.json({ ok: true, set: 'admin_token' });
  // важливо: sameSite повинно бути 'lax' (нижній регістр)
  res.cookies.set({
    name: 'admin_token',
    value: token,
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // можна true, якщо ставиш тільки на сервері; тут залишимо видимим у браузері
  });
  return res;
}
