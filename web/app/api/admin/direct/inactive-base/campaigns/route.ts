// web/app/api/admin/direct/inactive-base/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachClientsToCampaignAudience,
  getCampaignResponseCounts,
  getCampaignTelegramActiveClientCounts,
  getCampaignTelegramSendReadiness,
  isInactiveBaseSystemCampaign,
  parseInactiveBaseCampaignChannels,
} from '@/lib/inactive-base/campaign-audience';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { sendManualOutreachPackToAdmins } from '@/lib/inactive-base/manual-telegram-outreach-pack';

export const dynamic = 'force-dynamic';

function parseChannels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x === 'telegram' || x === 'instagram').map(String);
}

export async function GET(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const allRows = await prisma.inactiveBaseCampaign.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            channel: true,
            startedAt: true,
            sentCount: true,
            failedCount: true,
            skippedCount: true,
            selectedCount: true,
          },
        },
      },
    });
    const rows = allRows.filter((r) => !isInactiveBaseSystemCampaign(r.name));
    const campaignIds = rows.map((r) => r.id);
    const [responseStats, telegramReadiness, telegramActiveClients] = await Promise.all([
      getCampaignResponseCounts(campaignIds),
      getCampaignTelegramSendReadiness(campaignIds),
      getCampaignTelegramActiveClientCounts(campaignIds),
    ]);
    const items = rows.map((r) => {
      const stats = responseStats.get(r.id) ?? { clientCount: 0, respondedCount: 0 };
      const readiness = telegramReadiness.get(r.id) ?? {
        canSend: false,
        audienceCount: stats.clientCount,
        withTelegramCount: 0,
        withoutTelegramCount: stats.clientCount,
      };
      const channels = parseInactiveBaseCampaignChannels(r.channels);
      const tgActive = telegramActiveClients.get(r.id) ?? {
        outgoingManualCount: 0,
        outgoingSystemCount: 0,
        incomingCount: 0,
      };
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        clientCount: stats.clientCount,
        respondedCount: stats.respondedCount,
        telegramCanSend: readiness.canSend,
        telegramAudienceCount: readiness.audienceCount,
        telegramWithChatIdCount: readiness.withTelegramCount,
        telegramWithoutChatIdCount: readiness.withoutTelegramCount,
        hasTelegramChannel: channels.includes('telegram'),
        telegramActiveManualCount: tgActive.outgoingManualCount,
        telegramActiveSystemCount: tgActive.outgoingSystemCount,
        telegramActiveIncomingCount: tgActive.incomingCount,
      };
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error('[inactive-base/campaigns] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').toString().trim();
    const bodyTemplate = (body.bodyTemplate || '').toString().trim();
    const channels = parseChannels(body.channels);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'Назва кампанії обовʼязкова' }, { status: 400 });
    }
    if (!bodyTemplate) {
      return NextResponse.json({ ok: false, error: 'Текст кампанії обовʼязковий' }, { status: 400 });
    }
    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];

    const item = await prisma.inactiveBaseCampaign.create({
      data: {
        name,
        bodyTemplate,
        channels: channels.length ? channels : ['instagram', 'telegram'],
      },
    });

    let audienceCount = 0;
    if (clientIds.length > 0) {
      audienceCount = await attachClientsToCampaignAudience(item.id, clientIds, bodyTemplate);
    }

    const channelsFinal = channels.length ? channels : ['instagram', 'telegram'];
    let manualOutreachPack: Awaited<ReturnType<typeof sendManualOutreachPackToAdmins>> | null =
      null;
    if (channelsFinal.includes('telegram') && audienceCount > 0) {
      try {
        manualOutreachPack = await sendManualOutreachPackToAdmins(item.id);
      } catch (packErr) {
        console.error('[inactive-base/campaigns] manual outreach pack after create:', packErr);
      }
    }

    return NextResponse.json({ ok: true, item, audienceCount, manualOutreachPack });
  } catch (error) {
    console.error('[inactive-base/campaigns] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
