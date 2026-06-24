// web/app/admin/direct/actions/export-instagram-to-altegio.ts
// Server Action для експорту IG → Altegio (читає admin_token з cookies() на сервері).

'use server';

import { runExportInstagramToAltegioBatch } from '@/lib/direct/export-instagram-to-altegio-run';
import { getServerAdminToken, isAdminTokenValid } from '@/lib/server-admin-auth';

export async function exportInstagramToAltegioBatchAction(params: {
  offset: number;
  limit: number;
  delayMs: number;
}) {
  const token = await getServerAdminToken();
  if (!isAdminTokenValid(token)) {
    console.warn('[export-instagram-action] Unauthorized', { hasCookie: Boolean(token) });
    return {
      ok: false as const,
      error: 'Unauthorized',
      authDebug: { hasCookie: Boolean(token), via: 'server-action' },
    };
  }

  return runExportInstagramToAltegioBatch({
    offset: params.offset,
    limit: params.limit,
    delayMs: params.delayMs,
    maxRunMs: 240000,
  });
}
