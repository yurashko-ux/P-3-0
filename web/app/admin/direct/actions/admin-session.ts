// web/app/admin/direct/actions/admin-session.ts
'use server';

import { headers } from 'next/headers';
import { isAdminTokenValid, setServerAdminCookie } from '@/lib/server-admin-auth';

/** Встановлює cookie admin_token після перевірки ADMIN_PASS або u:… сесії. */
export async function setAdminSessionAction(token: string) {
  const t = (token || '').trim();
  if (!isAdminTokenValid(t)) {
    return { ok: false as const, error: 'Невірний токен' };
  }
  const ok = await setServerAdminCookie(t);
  if (!ok) {
    return { ok: false as const, error: 'Не вдалося зберегти сесію' };
  }
  return { ok: true as const };
}

export async function checkAdminSessionAction(clientToken?: string | null) {
  const host = (await headers()).get('host') || '';
  const { getServerAdminToken, isServerAdminAuthorized } = await import('@/lib/server-admin-auth');
  const fromCookie = await getServerAdminToken();
  const authorized = await isServerAdminAuthorized(host, clientToken);
  return {
    ok: authorized,
    hasCookie: Boolean(fromCookie),
    hasClientToken: Boolean((clientToken || '').trim()),
    host,
  };
}
