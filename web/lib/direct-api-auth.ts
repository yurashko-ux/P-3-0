// web/lib/direct-api-auth.ts
// Авторизація direct API — ідентична clients/route.ts + ?token=, Bearer, X-Admin-Token.

import { NextRequest } from 'next/server';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const CRON_SECRET = process.env.CRON_SECRET || '';

function collectTokens(req: NextRequest): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const t = (raw || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(req.cookies.get('admin_token')?.value);
  add(req.nextUrl.searchParams.get('token'));
  add((req.headers.get('authorization') || '').replace(/^bearer\s+/i, '').trim());
  add(req.headers.get('x-admin-token'));
  return out;
}

/** Така сама логіка як isAuthorized у clients/route.ts (без trim ADMIN_PASS). */
export function isDirectApiAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  const ADMIN_PASS = process.env.ADMIN_PASS || '';

  for (const token of collectTokens(req)) {
    if (ADMIN_PASS && token === ADMIN_PASS) return true;
    if (verifyUserToken(token)) return true;
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

export function getDirectApiAuthDebug(req: NextRequest): Record<string, unknown> {
  const tokens = collectTokens(req);
  return {
    tokenCount: tokens.length,
    hasCookieNext: Boolean(req.cookies.get('admin_token')?.value),
    hasQueryToken: Boolean(req.nextUrl.searchParams.get('token')),
    hasAuthorization: Boolean(req.headers.get('authorization')),
    hasXAdminToken: Boolean(req.headers.get('x-admin-token')),
    host: req.headers.get('host') || '',
  };
}
