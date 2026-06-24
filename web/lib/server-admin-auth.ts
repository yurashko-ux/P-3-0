// web/lib/server-admin-auth.ts
// Перевірка admin_token з cookies() у Server Actions / RSC.

import { cookies } from 'next/headers';
import { verifyUserToken } from '@/lib/auth-rbac';

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

export async function assertServerAdminAuth(): Promise<void> {
  const token = await getServerAdminToken();
  if (!isAdminTokenValid(token)) {
    throw new Error('Unauthorized');
  }
}
