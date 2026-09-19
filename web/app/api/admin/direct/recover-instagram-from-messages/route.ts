// web/app/api/admin/direct/recover-instagram-from-messages/route.ts
// Масове збереження реального Instagram з rawData повідомлень у direct_clients.

import { NextRequest, NextResponse } from 'next/server';
import { isDirectApiAuthorized } from '@/lib/direct-api-auth';
import { runRecoverInstagramFromMessagesBatch } from '@/lib/direct/recover-instagram-from-messages-run';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isDirectApiAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sp = req.nextUrl.searchParams;
    const offset = parseInt(String(sp.get('offset') ?? body.offset ?? 0), 10);
    const limit = parseInt(String(sp.get('limit') ?? body.limit ?? 80), 10);
    let clientId = (sp.get('clientId') ?? body.clientId) as string | undefined;
    const altegioClientIdRaw = sp.get('altegioClientId') ?? body.altegioClientId;
    const dryRun = sp.get('dryRun') === '1' || body.dryRun === true;

    // Зручно відновити одну картку: ?altegioClientId=160880614
    if (!clientId && altegioClientIdRaw != null && String(altegioClientIdRaw).trim()) {
      const { prisma } = await import('@/lib/prisma');
      const aid = parseInt(String(altegioClientIdRaw), 10);
      if (Number.isFinite(aid)) {
        const row = await prisma.directClient.findFirst({
          where: { altegioClientId: aid },
          select: { id: true },
        });
        if (row?.id) clientId = row.id;
      }
    }

    const result = await runRecoverInstagramFromMessagesBatch({
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 80,
      clientId,
      dryRun,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    const stats = result.stats || {};
    return NextResponse.json({
      ok: true,
      dryRun: result.dryRun,
      total: stats.totalTargets,
      recovered: stats.recovered,
      stats,
      samples: result.samples,
      errorDetails: result.errorDetails,
      results: result.samples,
      timestamp: result.timestamp,
    });
  } catch (err) {
    console.error('[recover-instagram-from-messages] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
