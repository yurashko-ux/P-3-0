// web/app/api/auth/login/route.ts
// Встановлює httpOnly cookie admin_pass (діє ~7 днів).
// Виклик: 
//   GET  /api/auth/login?pass=11111
//   POST /api/auth/login  { "pass": "11111" }

import { NextResponse } from 'next/server';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '11111';
const COOKIE_NAME = 'admin_pass';
const MAX_AGE = 7 * 24 * 60 * 60; // 7 днів

function buildLoginResponse(ok: boolean, msg: string, status = 200) {
  const res = NextResponse.json({ ok, message: msg }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (ok) {
    res.headers.set(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(ADMIN_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; ${
        process.env.NODE_ENV === 'production' ? 'Secure; ' : ''
      }`
    );
  }
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pass = url.searchParams.get('pass') || '';
  if (pass !== ADMIN_TOKEN) {
    return buildLoginResponse(false, 'Invalid pass', 401);
  }
  return buildLoginResponse(true, 'Logged in');
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const pass = String(body?.pass || '');
  if (pass !== ADMIN_TOKEN) {
    return buildLoginResponse(false, 'Invalid pass', 401);
  }
  return buildLoginResponse(true, 'Logged in');
}
