// web/lib/server-admin-auth.ts
// Перевірка admin_token з cookies() у Server Actions / RSC.

import { cookies } from 'next/headers';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

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
  return cookieStore.get('admin_token')?.value || '';
}

/** Cookie на сервері або токен з клієнта (localStorage / sessionStorage). */
export async function resolveServerAdminToken(clientToken?: string | null): Promise<string> {
  const fromCookie = await getServerAdminToken();
  if (fromCookie) return fromCookie.trim();
  const fromClient = (clientToken || '').trim();
  return fromClient;
}

export async function isServerAdminAuthorized(
  host: string,
  clientToken?: string | null,
): Promise<boolean> {
  if (isPreviewDeploymentHost(host)) return true;
  const token = await resolveServerAdminToken(clientToken);
  return isAdminTokenValid(token);
}

export async function assertServerAdminAuth(): Promise<void> {
  const token = await getServerAdminToken();
  if (!isAdminTokenValid(token)) {
    throw new Error('Unauthorized');
  }
}
