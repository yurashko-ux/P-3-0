// Історія Telegram-повідомлень клієнта (DirectMessage, source=telegram).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sourcesWhereClause, isTelegramCampaignSource } from '@/lib/direct-channel-chat';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { syncTelegramMessagesIfNeeded } from '@/lib/inactive-base/save-telegram-direct-message';

export const dynamic = 'force-dynamic';

async function resolveParams(params: { id: string } | Promise<{ id: string }>) {
  return params instanceof Promise ? await params : params;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: clientId } = await resolveParams(params);
    const limit = Math.min(
      500,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '200', 10) || 200)
    );

    const client = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        instagramUsername: true,
        telegramChatId: true,
        telegramUserId: true,
      },
    });

    if (!client) {
      return NextResponse.json({ ok: false, error: 'Клієнта не знайдено' }, { status: 404 });
    }

    const skipRepair = req.nextUrl.searchParams.get('repair') === '0';
    const forceRepair = req.nextUrl.searchParams.get('repair') === '1';

    const syncResult = skipRepair
      ? { repairedClientUserId: null, repairedDirections: 0, backfilledFromKv: 0, skipped: true }
      : await syncTelegramMessagesIfNeeded(clientId, client, { force: forceRepair });

    const rows = await prisma.directMessage.findMany({
      where: { clientId, ...sourcesWhereClause('telegram') },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        text: true,
        receivedAt: true,
        messageId: true,
        source: true,
      },
    });

    const fullName =
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || 'Невідомий клієнт';

    const messages = rows.map((m) => {
      const dir = String(m.direction || '').toLowerCase();
      const isSystem = isTelegramCampaignSource(m.source);
      return {
        id: m.id,
        direction: (dir === 'outgoing' ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
        text: m.text || '-',
        receivedAt: m.receivedAt.toISOString(),
        fullName,
        username: client.instagramUsername || undefined,
        source: m.source,
        messageKind: isSystem ? ('system' as const) : ('manual' as const),
      };
    });

    const freshClient = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { telegramChatId: true, telegramUserId: true },
    });

    const incomingCount = messages.filter((m) => m.direction === 'incoming').length;
    const outgoingCount = messages.filter((m) => m.direction === 'outgoing').length;

    return NextResponse.json(
      {
        ok: true,
        total: messages.length,
        incomingCount,
        outgoingCount,
        messages,
        source: 'database',
        repaired: skipRepair
          ? undefined
          : {
              clientUserId: syncResult.repairedClientUserId,
              directionsFixed: syncResult.repairedDirections,
              backfilledFromKv: syncResult.backfilledFromKv,
              skipped: syncResult.skipped,
            },
        client: {
          id: client.id,
          telegramChatId: freshClient?.telegramChatId?.toString() ?? null,
          telegramUserId: freshClient?.telegramUserId?.toString() ?? null,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('[clients/telegram-messages] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
