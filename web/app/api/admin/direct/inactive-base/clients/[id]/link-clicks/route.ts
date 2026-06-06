// Історія переходів по посиланнях кампаній для клієнта неактивної бази.

import { NextRequest, NextResponse } from 'next/server';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { getClientLinkClickHistory } from '@/lib/inactive-base/campaign-link-click-history';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: clientId } = await params;
  if (!clientId?.trim()) {
    return NextResponse.json({ ok: false, error: 'clientId обовʼязковий' }, { status: 400 });
  }

  try {
    const items = await getClientLinkClickHistory(clientId.trim());
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error('[inactive-base/clients/link-clicks] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
