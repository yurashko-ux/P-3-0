// Публічний редірект трекінг-посилання кампанії неактивної бази.

import { NextRequest, NextResponse } from 'next/server';
import { recordCampaignLinkClick } from '@/lib/inactive-base/campaign-link-tracking';

export const dynamic = 'force-dynamic';

async function resolveParams(params: { token: string } | Promise<{ token: string }>) {
  return params instanceof Promise ? await params : params;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } | Promise<{ token: string }> }
) {
  const { token: rawToken } = await resolveParams(params);
  const token = (rawToken || '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Невірне посилання' }, { status: 400 });
  }

  try {
    const result = await recordCampaignLinkClick(token);
    if (!result.ok || !result.destinationUrl) {
      return NextResponse.json(
        { ok: false, error: result.error || 'Посилання не знайдено' },
        { status: 404 }
      );
    }
    return NextResponse.redirect(result.destinationUrl, { status: 302 });
  } catch (error) {
    console.error('[inactive-base/go] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
