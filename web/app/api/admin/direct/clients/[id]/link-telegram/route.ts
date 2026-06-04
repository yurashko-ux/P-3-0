// Ручна привʼязка telegramChatId / telegramUserId до клієнта Direct.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

  try {
    const { id: clientId } = await resolveParams(params);
    const body = await req.json().catch(() => ({}));
    const chatIdRaw = body.telegramChatId ?? body.chatId;
    const userIdRaw = body.telegramUserId ?? body.userId;

    if (chatIdRaw == null && userIdRaw == null) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Потрібен telegramChatId і/або telegramUserId (число з Telegram / @userinfobot)',
        },
        { status: 400 }
      );
    }

    const data: { telegramChatId?: bigint; telegramUserId?: bigint } = {};
    if (chatIdRaw != null) data.telegramChatId = BigInt(String(chatIdRaw).trim());
    if (userIdRaw != null) data.telegramUserId = BigInt(String(userIdRaw).trim());

    const client = await prisma.directClient.update({
      where: { id: clientId },
      data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        telegramChatId: true,
        telegramUserId: true,
      },
    });

    console.log(
      `[link-telegram] clientId=${clientId} chatId=${client.telegramChatId?.toString()} userId=${client.telegramUserId?.toString()}`
    );

    return NextResponse.json({
      ok: true,
      client: {
        ...client,
        telegramChatId: client.telegramChatId?.toString() ?? null,
        telegramUserId: client.telegramUserId?.toString() ?? null,
      },
      message:
        'Привʼязано. Нові повідомлення в Business-чаті мають зберігатися. Старі не імпортуються автоматично.',
    });
  } catch (error) {
    console.error('[link-telegram] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
