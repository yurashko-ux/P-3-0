// Пакет для ручної відправки в Telegram: телефон окремо + чистий текст шаблону.

import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram/api';
import { getAdminChatIds, getDirectRemindersBotToken } from '@/lib/direct-reminders/telegram';
import { normalizePhone } from '@/lib/binotel/normalize-phone';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';
import { buildAdminCopyableMessageHtml } from '@/lib/inactive-base/manual-telegram-outreach-marker';
import {
  getClientIdsForCampaign,
  parseInactiveBaseCampaignChannels,
} from '@/lib/inactive-base/campaign-audience';

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
  error?: string;
};

/** Клієнти кампанії без telegramChatId з телефоном та готовим текстом. */
export async function buildManualOutreachPack(campaignId: string): Promise<{
  campaign: { id: string; name: string; bodyTemplate: string; channels: unknown };
  clients: ManualOutreachPackClient[];
  totalAudience: number;
  skippedNoPhone: number;
  skippedHasChatId: number;
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
    };
  }

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
  const clients: ManualOutreachPackClient[] = [];

  for (const row of rows) {
    if (row.telegramChatId != null) {
      skippedHasChatId += 1;
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
      error: 'Кампанію не знайдено',
    };
  }

  const { campaign, clients, totalAudience, skippedNoPhone, skippedHasChatId } = built;
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
      error: 'Немає admin chat ID (налаштуйте TELEGRAM_ADMIN_CHAT_IDS або DirectMaster)',
    };
  }

  if (clients.length === 0) {
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
      error:
        skippedHasChatId === totalAudience
          ? 'Усі клієнти вже мають telegramChatId'
          : 'Немає клієнтів з телефоном без telegramChatId',
    };
  }

  const botToken = getDirectRemindersBotToken();
  let messagesSent = 0;

  const intro = [
    `📋 «${campaign.name}» · ручна TG`,
    `Клієнтів: ${clients.length}`,
    '',
    'Кожне наступне повідомлення: телефон + ПІБ + текст — копіюйте цілком клієнту.',
  ].join('\n');

  for (const chatId of adminChatIds) {
    try {
      await sendMessage(chatId, intro, {}, botToken);
      messagesSent += 1;
      await sleep(TELEGRAM_DELAY_MS);

      for (const client of clients) {
        const fields = { firstName: client.firstName, lastName: client.lastName };
        const copyableHtml = buildAdminCopyableMessageHtml(
          client.phoneDisplay!,
          client.personalizedBody,
          campaign.bodyTemplate,
          client.clientId,
          fields
        );
        await sendMessage(chatId, copyableHtml, {}, botToken);
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
  };
}
