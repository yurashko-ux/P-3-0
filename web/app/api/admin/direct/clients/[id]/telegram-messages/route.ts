// Історія Telegram-повідомлень клієнта (DirectMessage, source=telegram).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';

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

    const rows = await prisma.directMessage.findMany({
      where: { clientId, source: 'telegram' },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        text: true,
        receivedAt: true,
        messageId: true,
      },
    });

    const fullName =
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || 'Невідомий клієнт';

    const messages = rows.map((m) => ({
      id: m.id,
      direction: m.direction as 'incoming' | 'outgoing',
      text: m.text || '-',
      receivedAt: m.receivedAt.toISOString(),
      fullName,
      username: client.instagramUsername || undefined,
    }));

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
        client: {
          id: client.id,
          telegramChatId: client.telegramChatId?.toString() ?? null,
          telegramUserId: client.telegramUserId?.toString() ?? null,
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
