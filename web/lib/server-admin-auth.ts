// web/lib/server-admin-auth.ts
// Перевірка admin_token: cookies(), заголовок Cookie, токен з клієнта.

import { cookies, headers } from 'next/headers';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

function parseCookieHeader(cookieHeader: string, name: string): string | null {
  for (const p of cookieHeader.split(/;\s*/)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim());
    }
  }
  return null;
}

export function isAdminTokenValid(token: string): boolean {
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  const t = (token || '').trim();
  if (!t) return false;
  if (ADMIN_PASS && t === ADMIN_PASS) return true;
  if (verifyUserToken(t)) return true;
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function getServerAdminToken(): Promise<string> {
  const cookieStore = await cookies();
  const fromNext = cookieStore.get('admin_token')?.value;
  if (fromNext) return fromNext;

  const h = await headers();
  const fromHeader = parseCookieHeader(h.get('cookie') || '', 'admin_token');
  return fromHeader || '';
}

export async function isServerAdminAuthorized(
  host: string,
  clientToken?: string | null,
): Promise<boolean> {
  if (isPreviewDeploymentHost(host)) return true;

  const fromCookie = (await getServerAdminToken()).trim();
  if (fromCookie && isAdminTokenValid(fromCookie)) return true;

  const fromClient = (clientToken || '').trim();
  if (fromClient && isAdminTokenValid(fromClient)) return true;

  return false;
}

export async function setServerAdminCookie(token: string): Promise<boolean> {
  const t = (token || '').trim();
  if (!isAdminTokenValid(t)) return false;

  const h = await headers();
  const isHttps =
    h.get('x-forwarded-proto')?.toLowerCase() === 'https' ||
    h.get('x-forwarded-host')?.includes('vercel.app');

  const cookieStore = await cookies();
  cookieStore.set('admin_token', t, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: isHttps,
    maxAge: 60 * 60 * 24 * 7,
  });
  return true;
}
