// web/lib/direct-admin-auth.ts
// Єдина авторизація для admin/direct API: cookie admin_token, ?token=, Authorization Bearer.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const CRON_SECRET = process.env.CRON_SECRET || '';

function readBearerToken(req: NextRequest): string {
  const authHeader = req.headers.get('authorization') || '';
  return authHeader.replace(/^bearer\s+/i, '').trim();
}

function readCookieFromHeader(req: NextRequest, name: string): string | null {
  const all = req.headers.get('cookie');
  if (!all) return null;
  const parts = all.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Усі можливі токени з запиту (без дублікатів). */
export function collectAdminTokensFromRequest(req: NextRequest): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const t = (raw || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  add(req.cookies.get('admin_token')?.value);
  add(readCookieFromHeader(req, 'admin_token'));
  add(req.nextUrl.searchParams.get('token'));
  add(readBearerToken(req));
  return out;
}

function isTokenAuthorized(token: string): boolean {
  if (!token) return false;
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  if (ADMIN_PASS && token === ADMIN_PASS) return true;
  if (verifyUserToken(token)) return true;
  return false;
}

export function getDirectAdminAuthDebug(req: NextRequest): Record<string, unknown> {
  const tokens = collectAdminTokensFromRequest(req);
  return {
    tokenCount: tokens.length,
    hasCookieNext: Boolean(req.cookies.get('admin_token')?.value),
    hasCookieHeader: Boolean(readCookieFromHeader(req, 'admin_token')),
    hasQueryToken: Boolean(req.nextUrl.searchParams.get('token')),
    hasAuthorization: Boolean(req.headers.get('authorization')),
    host: req.headers.get('host') || '',
  };
}

/** Sync: перевірка токена без запиту до БД. */
export function isDirectAdminAuthorized(req: NextRequest): boolean {
  const host = req.headers.get('host') || '';
  if (isPreviewDeploymentHost(host)) return true;

  for (const token of collectAdminTokensFromRequest(req)) {
    if (isTokenAuthorized(token)) return true;
  }

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Async: sync-перевірка (як clients/route) + getAuthContext для RBAC. */
export async function isDirectAdminAuthorizedAsync(req: NextRequest): Promise<boolean> {
  if (isDirectAdminAuthorized(req)) return true;

  const host = req.headers.get('host') || '';
  if (isPreviewDeploymentHost(host)) return true;

  const auth = await getAuthContext(req);
  if (auth) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Зберігає валідний ?token= у cookie admin_token для наступних запитів. */
export function applyDirectAdminCookieIfToken(req: NextRequest, res: NextResponse): NextResponse {
  const token = (req.nextUrl.searchParams.get('token') || '').trim();
  if (!token || !isTokenAuthorized(token)) return res;

  const isHttps = (() => {
    try {
      const xfProto = (req.headers.get('x-forwarded-proto') || '').toLowerCase();
      return req.nextUrl.protocol === 'https:' || xfProto === 'https';
    } catch {
      return true;
    }
  })();

  res.cookies.set('admin_token', token, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: isHttps,
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
