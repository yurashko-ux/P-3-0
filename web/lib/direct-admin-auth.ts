// web/lib/direct-admin-auth.ts
// Єдина авторизація для admin/direct API: cookie admin_token, ?token= (RBAC u:… або ADMIN_PASS), CRON_SECRET.

import { NextRequest } from 'next/server';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

export function isDirectAdminAuthorized(req: NextRequest): boolean {
  const host = req.headers.get('host') || '';
  if (isPreviewDeploymentHost(host)) return true;

  const adminToken = (req.cookies.get('admin_token')?.value || '').trim();
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;

  const tokenParam = (req.nextUrl.searchParams.get('token') || '').trim();
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;
  if (verifyUserToken(tokenParam)) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}
