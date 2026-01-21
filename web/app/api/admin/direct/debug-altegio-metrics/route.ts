// web/app/api/admin/direct/debug-altegio-metrics/route.ts
// DEBUG endpoint: перевірка, що Altegio повертає phone/visits/spent для конкретного clientId
// НЕ логуємо PII (телефон/суми), тільки наявність/типи.

import { NextRequest, NextResponse } from 'next/server';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const altegioClientIdRaw = req.nextUrl.searchParams.get('altegioClientId') || '';
  const clientId = (req.nextUrl.searchParams.get('clientId') || '').toString().trim();
  const instagramUsernameRaw = (req.nextUrl.searchParams.get('instagramUsername') || '').toString().trim();

  let altegioClientId = Number(altegioClientIdRaw);
  if (!altegioClientId || Number.isNaN(altegioClientId)) {
    // Підтягуємо altegioClientId з БД за clientId або instagramUsername
    try {
      const where =
        clientId
          ? { id: clientId }
          : instagramUsernameRaw
            ? { instagramUsername: instagramUsernameRaw.toLowerCase() }
            : null;
      if (!where) {
        return NextResponse.json(
          { ok: false, error: 'Provide altegioClientId OR (clientId / instagramUsername)' },
          { status: 400 }
        );
      }

      const dc = await prisma.directClient.findFirst({
        where,
        select: { id: true, instagramUsername: true, altegioClientId: true },
      });

      if (!dc?.altegioClientId) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Direct client not found or has no altegioClientId',
            debug: { clientId: dc?.id || null, instagramUsername: dc?.instagramUsername || null },
          },
          { status: 404 }
        );
      }
      altegioClientId = dc.altegioClientId;
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  const res = await fetchAltegioClientMetrics({ altegioClientId });
  if (res.ok === false) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    altegioClientId,
    parsed: {
      phonePresent: Boolean(res.metrics.phone),
      visitsPresent: res.metrics.visits !== null && res.metrics.visits !== undefined,
      spentPresent: res.metrics.spent !== null && res.metrics.spent !== undefined,
      visitsValue: res.metrics.visits ?? null,
      spentIsZero: (res.metrics.spent ?? null) === 0,
    },
  });
}

