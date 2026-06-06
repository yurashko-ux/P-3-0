// Надіслати адміну в Telegram пакет для ручної відправки (телефон + personalizedBody).

import { NextRequest, NextResponse } from 'next/server';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { sendManualOutreachPackToAdmins } from '@/lib/inactive-base/manual-telegram-outreach-pack';

export const dynamic = 'force-dynamic';

async function resolveParams(params: { id: string } | Promise<{ id: string }>) {
  return params instanceof Promise ? await params : params;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: campaignId } = await resolveParams(params);

  try {
    const result = await sendManualOutreachPackToAdmins(campaignId);
    if (!result.ok && result.error) {
      const status = result.error.includes('не знайдено') ? 404 : 400;
      return NextResponse.json({ ok: false, ...result }, { status });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[inactive-base/campaigns/manual-outreach-pack] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
