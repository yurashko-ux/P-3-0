// web/lib/inactive-base/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, hasPermission, verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

/** Чи є доступ до розділу «Неактивна база» (логін + право inactiveBaseSection). */
export async function isInactiveBaseAuthorized(req: NextRequest): Promise<boolean> {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  const adminToken = req.cookies.get('admin_token')?.value || '';
  // Супер-адмін за ADMIN_PASS — повний доступ
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const auth = await getAuthContext(req);
  if (!auth) {
    // Fallback: старий sync-шлях (лише факт логіну user-токена) — якщо getAuthContext упав
    if (verifyUserToken(adminToken)) {
      console.warn('[inactive-base/auth] getAuthContext порожній, але user-токен є — відхиляємо без права');
    }
    if (!ADMIN_PASS && !CRON_SECRET) return true;
    return false;
  }

  return hasPermission(auth.permissions, 'inactiveBaseSection');
}

/** Повна перевірка з відповіддю 401/403. */
export async function requireInactiveBaseSection(
  req: NextRequest,
  mode: 'view' | 'edit' = 'view',
): Promise<true | NextResponse> {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  const auth = await getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
  }
  if (!hasPermission(auth.permissions, 'inactiveBaseSection')) {
    return NextResponse.json({ error: 'Немає доступу до Неактивної бази' }, { status: 403 });
  }
  if (mode === 'edit' && auth.type !== 'superadmin' && auth.permissions.inactiveBaseSection !== 'edit') {
    return NextResponse.json({ error: 'Немає права змінювати Неактивну базу' }, { status: 403 });
  }
  return true;
}
