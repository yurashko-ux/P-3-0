// web/app/admin/direct/actions/export-instagram-to-altegio.ts
// Server Action для експорту IG → Altegio (cookie на сервері + fallback токен з клієнта).

'use server';

import { headers } from 'next/headers';
import { runExportInstagramToAltegioBatch } from '@/lib/direct/export-instagram-to-altegio-run';
import {
  getServerAdminToken,
  isServerAdminAuthorized,
} from '@/lib/server-admin-auth';

export async function exportInstagramToAltegioBatchAction(params: {
  offset: number;
  limit: number;
  delayMs: number;
  /** Fallback: ADMIN_PASS / u:… з localStorage, sessionStorage або ?token= у браузері */
  adminToken?: string | null;
}) {
  const host = (await headers()).get('host') || '';
  const fromCookie = await getServerAdminToken();

  if (!(await isServerAdminAuthorized(host, params.adminToken))) {
    console.warn('[export-instagram-action] Unauthorized', {
      host,
      hasCookie: Boolean(fromCookie),
      hasClientToken: Boolean((params.adminToken || '').trim()),
    });
    return {
      ok: false as const,
      error: 'Unauthorized',
      authDebug: {
        hasCookie: Boolean(fromCookie),
        hasClientToken: Boolean((params.adminToken || '').trim()),
        via: 'server-action',
        host,
      },
    };
  }

  return runExportInstagramToAltegioBatch({
    offset: params.offset,
    limit: params.limit,
    delayMs: params.delayMs,
    maxRunMs: 240000,
  });
}
