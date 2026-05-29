// web/app/api/admin/direct/inactive-base/campaigns/[id]/send/route.ts
// Розсилка кампанії: Instagram (ручний пакет) або Telegram (через Business bot).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';
import { getStoredBusinessConnectionId, bigintToNumber } from '@/lib/inactive-base/telegram-business';
import { getDirectRemindersBotToken } from '@/lib/direct-reminders/telegram';
import { sendMessage } from '@/lib/telegram/api';
import { kvWrite } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TELEGRAM_DELAY_MS = 45;

async function resolveParams(params: { id: string } | Promise<{ id: string }>) {
  return params instanceof Promise ? await params : params;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function logTelegramOutbound(payload: Record<string, unknown>) {
  try {
    const key = `inactive-base:telegram:outbound:${Date.now()}`;
    await kvWrite.lpush(
      'inactive-base:telegram:outbound:log',
      JSON.stringify({ ...payload, at: new Date().toISOString(), key })
    );
    await kvWrite.ltrim('inactive-base:telegram:outbound:log', 0, 499);
  } catch (err) {
    console.warn('[inactive-base/send] KV log failed:', err);
  }
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
    const channel = body.channel === 'telegram' ? 'telegram' : 'instagram';
    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];

    if (clientIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Оберіть хоча б одного клієнта' }, { status: 400 });
    }

    const campaign = await prisma.inactiveBaseCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
    }

    const clients = await prisma.directClient.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        instagramUsername: true,
        phone: true,
        telegramChatId: true,
      },
    });

    const runChannel = channel === 'telegram' ? 'telegram' : 'manual_instagram';
    const run = await prisma.inactiveBaseCampaignRun.create({
      data: {
        campaignId,
        channel: runChannel,
        selectedCount: clientIds.length,
      },
    });

    const prepared: Array<{
      clientId: string;
      instagramUsername: string;
      fullName: string;
      phone: string | null;
      personalizedBody: string;
      telegramChatId: number | null;
      status: string;
      error?: string;
    }> = [];

    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = clientIds.filter((id) => !clients.some((c) => c.id === id)).length;

    const businessConnectionId = channel === 'telegram' ? await getStoredBusinessConnectionId() : null;
    const botToken = channel === 'telegram' ? getDirectRemindersBotToken() : null;

    if (channel === 'telegram' && !businessConnectionId) {
      console.warn('[inactive-base/send] TELEGRAM_BUSINESS_CONNECTION_ID не налаштовано — розсилка пропустить усіх');
    }

    for (const client of clients) {
      const personalizedBody = renderCampaignBody(campaign.bodyTemplate, {
        firstName: client.firstName,
        lastName: client.lastName,
      });
      const chatId = bigintToNumber(client.telegramChatId);
      let status = 'prepared';
      let error: string | undefined;

      if (channel === 'instagram') {
        status = 'prepared';
        sentCount += 0;
      } else if (!chatId) {
        status = 'skipped';
        error = 'Немає telegramChatId (клієнт не писав у Telegram салону)';
        skippedCount++;
      } else if (!businessConnectionId) {
        status = 'skipped';
        error = 'Не налаштовано business_connection_id (підключіть Telegram Business до HOB_client_bot)';
        skippedCount++;
      } else {
        try {
          await sendMessage(
            chatId,
            personalizedBody,
            { business_connection_id: businessConnectionId },
            botToken!
          );
          await logTelegramOutbound({
            campaignId,
            runId: run.id,
            clientId: client.id,
            chatId,
            channel: 'telegram',
          });
          status = 'sent';
          sentCount++;
          await sleep(TELEGRAM_DELAY_MS);
        } catch (err) {
          status = 'failed';
          error = err instanceof Error ? err.message : String(err);
          failedCount++;
          console.error(`[inactive-base/send] Telegram fail clientId=${client.id}:`, err);
        }
      }

      const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || '—';

      await prisma.inactiveBaseCampaignDelivery.create({
        data: {
          runId: run.id,
          clientId: client.id,
          status,
          personalizedBody,
          error: error ?? null,
          sentAt: status === 'sent' ? new Date() : null,
        },
      });

      prepared.push({
        clientId: client.id,
        instagramUsername: client.instagramUsername,
        fullName,
        phone: client.phone,
        personalizedBody,
        telegramChatId: chatId,
        status,
        error,
      });
    }

    const foundIds = new Set(clients.map((c) => c.id));
    for (const missingId of clientIds.filter((id) => !foundIds.has(id))) {
      await prisma.inactiveBaseCampaignDelivery.create({
        data: {
          runId: run.id,
          clientId: missingId,
          status: 'skipped',
          error: 'Клієнта не знайдено',
          personalizedBody: null,
        },
      });
    }

    const effectiveSent = channel === 'instagram' ? prepared.length : sentCount;

    await prisma.inactiveBaseCampaignRun.update({
      where: { id: run.id },
      data: {
        sentCount: channel === 'instagram' ? 0 : sentCount,
        failedCount,
        skippedCount,
        selectedCount: clientIds.length,
      },
    });

    return NextResponse.json({
      ok: true,
      runId: run.id,
      channel,
      prepared,
      stats: {
        selected: clientIds.length,
        sent: channel === 'instagram' ? 0 : sentCount,
        prepared: channel === 'instagram' ? effectiveSent : 0,
        failed: failedCount,
        skipped: skippedCount,
      },
    });
  } catch (error) {
    console.error('[inactive-base/campaigns/send] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
