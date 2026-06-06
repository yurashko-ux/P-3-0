// Пакет для ручної відправки в Telegram: телефон окремо + чистий текст шаблону.

import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram/api';
import { getAdminChatIds, getDirectRemindersBotToken } from '@/lib/direct-reminders/telegram';
import { normalizePhone } from '@/lib/binotel/normalize-phone';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';
import {
  buildAdminPibMessage,
  buildAdminTemplateOnlyMessageHtml,
} from '@/lib/inactive-base/manual-telegram-outreach-marker';
import {
  getClientIdsForCampaign,
  parseInactiveBaseCampaignChannels,
} from '@/lib/inactive-base/campaign-audience';
import { clientCanReceiveTelegramSystemMessage } from '@/lib/inactive-base/telegram-can-send-filter';

const TELEGRAM_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPhoneDisplay(phone: string | null | undefined): string | null {
  const norm = normalizePhone(phone);
  if (!norm || norm.length < 10) return null;
  if (norm.startsWith('380') && norm.length >= 12) {
    return `+${norm.slice(0, 12)}`;
  }
  return `+${norm}`;
}

export type ManualOutreachPackClient = {
  clientId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  personalizedBody: string;
};

export type ManualOutreachPackResult = {
  ok: boolean;
  campaignId: string;
  campaignName: string;
  totalAudience: number;
  clientsForManual: ManualOutreachPackClient[];
  messagesSent: number;
  adminChatIds: number[];
  skippedNoPhone: number;
  skippedHasChatId: number;
  skippedAlreadySentApi: number;
  error?: string;
};

/** Клієнти для ручної TG: без telegramChatId, не отримували API-розсилку в цій кампанії. */
export async function buildManualOutreachPack(campaignId: string): Promise<{
  campaign: { id: string; name: string; bodyTemplate: string; channels: unknown };
  clients: ManualOutreachPackClient[];
  totalAudience: number;
  skippedNoPhone: number;
  skippedHasChatId: number;
  skippedAlreadySentApi: number;
} | null> {
  const campaign = await prisma.inactiveBaseCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, bodyTemplate: true, channels: true },
  });
  if (!campaign) return null;

  const channels = parseInactiveBaseCampaignChannels(campaign.channels);
  if (!channels.includes('telegram')) {
    return {
      campaign,
      clients: [],
      totalAudience: 0,
      skippedNoPhone: 0,
      skippedHasChatId: 0,
      skippedAlreadySentApi: 0,
    };
  }

  const audienceIds = [...(await getClientIdsForCampaign(campaignId))];
  if (audienceIds.length === 0) {
    return {
      campaign,
      clients: [],
      totalAudience: 0,
      skippedNoPhone: 0,
      skippedHasChatId: 0,
      skippedAlreadySentApi: 0,
    };
  }

  const alreadySentApiRows = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: {
      clientId: { in: audienceIds },
      status: 'sent',
      run: { campaignId, channel: 'telegram' },
    },
    select: { clientId: true },
  });
  const alreadySentApiIds = new Set(alreadySentApiRows.map((r) => r.clientId));

  const rows = await prisma.directClient.findMany({
    where: { id: { in: audienceIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      telegramChatId: true,
    },
  });

  let skippedNoPhone = 0;
  let skippedHasChatId = 0;
  let skippedAlreadySentApi = 0;
  const clients: ManualOutreachPackClient[] = [];

  for (const row of rows) {
    if (clientCanReceiveTelegramSystemMessage(row)) {
      skippedHasChatId += 1;
      continue;
    }
    if (alreadySentApiIds.has(row.id)) {
      skippedAlreadySentApi += 1;
      continue;
    }
    const phoneDisplay = formatPhoneDisplay(row.phone);
    if (!phoneDisplay) {
      skippedNoPhone += 1;
      continue;
    }
    clients.push({
      clientId: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      phoneDisplay,
      personalizedBody: renderCampaignBody(campaign.bodyTemplate, {
        firstName: row.firstName,
        lastName: row.lastName,
      }),
    });
  }

  clients.sort((a, b) => {
    const an = [a.lastName, a.firstName].filter(Boolean).join(' ');
    const bn = [b.lastName, b.firstName].filter(Boolean).join(' ');
    return an.localeCompare(bn, 'uk');
  });

  return {
    campaign,
    clients,
    totalAudience: audienceIds.length,
    skippedNoPhone,
    skippedHasChatId,
    skippedAlreadySentApi,
  };
}

/** Надіслати пакет ручної розсилки всім адмін-чатам у Telegram. */
export async function sendManualOutreachPackToAdmins(campaignId: string): Promise<ManualOutreachPackResult> {
  const built = await buildManualOutreachPack(campaignId);
  if (!built) {
    return {
      ok: false,
      campaignId,
      campaignName: '',
      totalAudience: 0,
      clientsForManual: [],
      messagesSent: 0,
      adminChatIds: [],
      skippedNoPhone: 0,
      skippedHasChatId: 0,
      skippedAlreadySentApi: 0,
      error: 'Кампанію не знайдено',
    };
  }

  const { campaign, clients, totalAudience, skippedNoPhone, skippedHasChatId, skippedAlreadySentApi } =
    built;
  const adminChatIds = await getAdminChatIds();

  if (adminChatIds.length === 0) {
    return {
      ok: false,
      campaignId,
      campaignName: campaign.name,
      totalAudience,
      clientsForManual: clients,
      messagesSent: 0,
      adminChatIds: [],
      skippedNoPhone,
      skippedHasChatId,
      skippedAlreadySentApi,
      error: 'Немає admin chat ID (налаштуйте TELEGRAM_ADMIN_CHAT_IDS або DirectMaster)',
    };
  }

  if (clients.length === 0) {
    const onlySystem =
      skippedHasChatId + skippedAlreadySentApi >= totalAudience && totalAudience > 0;
    return {
      ok: true,
      campaignId,
      campaignName: campaign.name,
      totalAudience,
      clientsForManual: [],
      messagesSent: 0,
      adminChatIds,
      skippedNoPhone,
      skippedHasChatId,
      skippedAlreadySentApi,
      error: onlySystem
        ? 'Усі клієнти вже з telegramChatId або отримали API-розсилку — ручний пакет не потрібен'
        : 'Немає клієнтів з телефоном для ручної відправки',
    };
  }

  const botToken = getDirectRemindersBotToken();
  let messagesSent = 0;

  const intro = [
    `📋 «${campaign.name}» · ручна TG`,
    `Для ручної відправки: ${clients.length}`,
    skippedHasChatId > 0 ? `Пропущено (є telegramChatId, API): ${skippedHasChatId}` : null,
    skippedAlreadySentApi > 0 ? `Пропущено (вже надіслано API): ${skippedAlreadySentApi}` : null,
    skippedNoPhone > 0 ? `Без телефону: ${skippedNoPhone}` : null,
    '',
    'По кожному клієнту 3 повідомлення: 1) телефон  2) ПІБ  3) текст для клієнта.',
  ]
    .filter(Boolean)
    .join('\n');

  for (const chatId of adminChatIds) {
    try {
      await sendMessage(chatId, intro, {}, botToken);
      messagesSent += 1;
      await sleep(TELEGRAM_DELAY_MS);

      for (const client of clients) {
        const fields = { firstName: client.firstName, lastName: client.lastName };

        await sendMessage(chatId, client.phoneDisplay!, {}, botToken);
        messagesSent += 1;
        await sleep(TELEGRAM_DELAY_MS);

        await sendMessage(chatId, buildAdminPibMessage(fields), {}, botToken);
        messagesSent += 1;
        await sleep(TELEGRAM_DELAY_MS);

        const templateHtml = buildAdminTemplateOnlyMessageHtml(
          client.personalizedBody,
          campaign.bodyTemplate,
          client.clientId,
          fields
        );
        await sendMessage(chatId, templateHtml, {}, botToken);
        messagesSent += 1;
        await sleep(TELEGRAM_DELAY_MS);
      }
    } catch (err) {
      console.error(
        `[manual-telegram-outreach-pack] fail chatId=${chatId} campaignId=${campaignId}:`,
        err
      );
    }
  }

  console.log(
    `[manual-telegram-outreach-pack] campaignId=${campaignId} clients=${clients.length} messagesSent=${messagesSent} admins=${adminChatIds.length}`
  );

  return {
    ok: true,
    campaignId,
    campaignName: campaign.name,
    totalAudience,
    clientsForManual: clients,
    messagesSent,
    adminChatIds,
    skippedNoPhone,
    skippedHasChatId,
    skippedAlreadySentApi,
  };
}
