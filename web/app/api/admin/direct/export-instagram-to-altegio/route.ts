// web/app/api/admin/direct/export-instagram-to-altegio/route.ts
// Експорт реальних Instagram username з Direct в Altegio custom field «Instagram user name»

import { NextRequest, NextResponse } from 'next/server';
import { runExportInstagramToAltegioBatch } from '@/lib/direct/export-instagram-to-altegio-run';
import { isDirectApiAuthorized, getDirectApiAuthDebug } from '@/lib/direct-api-auth';
import { applyDirectAdminCookieIfToken } from '@/lib/direct-admin-auth';

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isDirectApiAuthorized(req)) {
    const authDebug = getDirectApiAuthDebug(req);
    console.warn('[direct/export-instagram-to-altegio] Unauthorized', authDebug);
    return NextResponse.json(
      { ok: false, error: 'Unauthorized', authDebug },
      { status: 401 },
    );
  }

  const delayMsRaw = req.nextUrl.searchParams.get('delayMs');
  const delayMs = Math.max(0, Math.min(2000, Number(delayMsRaw ?? '250') || 250));
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = Math.max(0, Math.min(5000, Number(limitRaw ?? '200') || 200));
  const offsetRaw = req.nextUrl.searchParams.get('offset');
  const offset = Math.max(0, Number(offsetRaw ?? '0') || 0);
  const maxRunMsParam = parseInt(req.nextUrl.searchParams.get('maxRunMs') || '240000', 10);
  const maxRunMs = Number.isFinite(maxRunMsParam) ? Math.min(280000, Math.max(10000, maxRunMsParam)) : 240000;

  const result = await runExportInstagramToAltegioBatch({
    offset,
    limit,
    delayMs,
    maxRunMs,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === 'Unauthorized' ? 401 : 500 });
  }

  return applyDirectAdminCookieIfToken(req, NextResponse.json(result));
}
