// Діагностика Telegram Business: webhook KV, привʼязка клієнта, DirectMessage.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { getStoredBusinessConnectionId } from '@/lib/inactive-base/telegram-business';
import { kvRead } from '@/lib/kv';
import { getDirectRemindersBotToken } from '@/lib/direct-reminders/telegram';

export const dynamic = 'force-dynamic';

function parseKvJson(raw: unknown): Record<string, unknown> | null {
  try {
    let v: unknown = raw;
    if (typeof v === 'string') v = JSON.parse(v);
    if (v && typeof v === 'object' && 'value' in v && typeof (v as { value: string }).value === 'string') {
      v = JSON.parse((v as { value: string }).value);
    }
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = (req.nextUrl.searchParams.get('clientId') || '').trim();
    const name = (req.nextUrl.searchParams.get('name') || '').trim();

    let client: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      instagramUsername: string;
      phone: string | null;
      telegramChatId: bigint | null;
      telegramUserId: bigint | null;
    } | null = null;

    if (clientId) {
      client = await prisma.directClient.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          phone: true,
          telegramChatId: true,
          telegramUserId: true,
        },
      });
    } else if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      const a = parts[0] ?? '';
      const b = parts.slice(1).join(' ') || a;
      const rows = await prisma.directClient.findMany({
        where: {
          OR: [
            {
              AND: [
                { firstName: { contains: a, mode: 'insensitive' } },
                { lastName: { contains: b, mode: 'insensitive' } },
              ],
            },
            {
              AND: [
                { firstName: { contains: b, mode: 'insensitive' } },
                { lastName: { contains: a, mode: 'insensitive' } },
              ],
            },
            { instagramUsername: { contains: a, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          phone: true,
          telegramChatId: true,
          telegramUserId: true,
        },
        take: 5,
      });
      if (rows.length === 1) client = rows[0];
      else if (rows.length > 1) {
        return NextResponse.json({ ok: true, multipleClients: rows, hint: 'Вкажіть clientId' });
      }
    }

    const telegramMessages = client
      ? await prisma.directMessage.findMany({
          where: { clientId: client.id, source: 'telegram' },
          orderBy: { receivedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            direction: true,
            text: true,
            receivedAt: true,
            messageId: true,
          },
        })
      : [];

    const rawLog = await kvRead.lrange('telegram:direct-reminders:log', 0, 19);
    const recentWebhook = rawLog.map(parseKvJson).filter(Boolean) as Record<string, unknown>[];

    const rawUnlinked = await kvRead.lrange('telegram:direct-reminders:unlinked', 0, 9);
    const unlinked = rawUnlinked.map(parseKvJson).filter(Boolean);

    let webhookInfo: Record<string, unknown> | null = null;
    const token = getDirectRemindersBotToken();
    if (token) {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const data = await res.json();
      if (data.ok) {
        webhookInfo = {
          url: data.result?.url,
          pendingUpdateCount: data.result?.pending_update_count,
          lastErrorMessage: data.result?.last_error_message,
          allowedUpdates: data.result?.allowed_updates,
        };
      }
    }

    const businessConnectionId = await getStoredBusinessConnectionId();

    return NextResponse.json({
      ok: true,
      client: client
        ? {
            ...client,
            telegramChatId: client.telegramChatId?.toString() ?? null,
            telegramUserId: client.telegramUserId?.toString() ?? null,
          }
        : null,
      telegramMessageCount: telegramMessages.length,
      telegramMessages: telegramMessages.map((m) => ({
        ...m,
        receivedAt: m.receivedAt.toISOString(),
      })),
      businessConnectionId: businessConnectionId ? `${businessConnectionId.slice(0, 8)}…` : null,
      hasBusinessConnection: Boolean(businessConnectionId),
      webhookInfo,
      recentWebhook: recentWebhook.map((e) => ({
        receivedAt: e.receivedAt,
        hasBusinessMessage: e.hasBusinessMessage,
        hasBusinessConnection: e.hasBusinessConnection,
        businessMessageText: e.businessMessageText,
        businessChatId: e.businessChatId,
        businessFromId: e.businessFromId,
        messageText: e.messageText,
      })),
      unlinked,
      recommendations: [
        !webhookInfo?.url
          ? 'Webhook URL порожній — натисніть «Налаштувати webhook» у Direct.'
          : null,
        webhookInfo?.lastErrorMessage
          ? `Помилка Telegram webhook: ${webhookInfo.lastErrorMessage}`
          : null,
        !businessConnectionId
          ? 'Немає business_connection_id — перепідключіть HOB_client_bot у Telegram Business.'
          : null,
        client && !client.telegramUserId
          ? 'У клієнта немає telegramUserId — webhook не привʼязав чат. Надішліть нове повідомлення з Telegram або використайте link-telegram.'
          : null,
        recentWebhook.length > 0 &&
        !recentWebhook.some((e) => e.hasBusinessMessage)
          ? 'У KV-логах немає business_message — Telegram не надсилає Business-апдейти на webhook.'
          : null,
      ].filter(Boolean),
      debugUrl:
        'https://p-3-0.vercel.app/api/admin/direct/telegram-business-debug?clientId=... або ?name=Юрашко+Микола',
    });
  } catch (error) {
    console.error('[telegram-business-debug] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
