// Зняття виділених клієнтів з групи кампанії («Немає групи»).

import { NextRequest, NextResponse } from 'next/server';
import { removeClientsFromCampaignGroups } from '@/lib/inactive-base/campaign-audience';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];

    if (clientIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Оберіть хоча б одного клієнта' }, { status: 400 });
    }

    const removedCount = await removeClientsFromCampaignGroups(clientIds);

    console.log(`[inactive-base/remove-from-group] removed=${removedCount} clients=${clientIds.length}`);

    return NextResponse.json({ ok: true, removedCount });
  } catch (error) {
    console.error('[inactive-base/campaigns/remove-from-group] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
