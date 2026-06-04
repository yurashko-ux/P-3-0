// Перенесення виділених клієнтів у кампанію (нова audience-запис, остання кампанія в таблиці оновиться).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { attachClientsToCampaignAudience } from '@/lib/inactive-base/campaign-audience';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';

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
    const body = await req.json().catch(() => ({}));
    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];

    if (clientIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Оберіть хоча б одного клієнта' }, { status: 400 });
    }

    const campaign = await prisma.inactiveBaseCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, bodyTemplate: true },
    });
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
    }

    const transferredCount = await attachClientsToCampaignAudience(
      campaign.id,
      clientIds,
      campaign.bodyTemplate
    );

    console.log(
      `[inactive-base/transfer] campaignId=${campaignId} name=${campaign.name} transferred=${transferredCount}`
    );

    return NextResponse.json({
      ok: true,
      transferredCount,
      campaignId: campaign.id,
      campaignName: campaign.name,
    });
  } catch (error) {
    console.error('[inactive-base/campaigns/[id]/transfer] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
