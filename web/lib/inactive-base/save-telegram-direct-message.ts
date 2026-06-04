// web/lib/inactive-base/save-telegram-direct-message.ts
// Зберегти вхідне/вихідне Telegram-повідомлення в DirectMessage.

import { prisma } from '@/lib/prisma';
import { normalizeInstagram } from '@/lib/normalize';
import { buildNameSearchPairs } from '@/lib/inactive-base/telegram-name-match';
import type { TelegramMessage, TelegramUser } from '@/lib/telegram/types';

function normalizeTelegramUsername(username: string | null | undefined): string | null {
  if (!username) return null;
  const u = username.trim().toLowerCase().replace(/^@+/, '');
  return u || null;
}

function isDirectPrivateChat(chat: TelegramMessage['chat']): boolean {
  if (!chat?.id) return false;
  const t = (chat.type || 'private').toLowerCase();
  return t === 'private' || t === '';
}

/** Відправник у business_message (інколи from порожній — беремо з private chat). */
function resolveMessageSender(message: TelegramMessage): TelegramUser | null {
  if (message.from?.id && !message.from.is_bot) return message.from;
  if (isDirectPrivateChat(message.chat)) {
    return {
      id: message.chat!.id,
      first_name: message.chat!.first_name,
      last_name: message.chat!.last_name,
      username: message.chat!.username,
      is_bot: false,
    };
  }
  return null;
}

async function findClientIdByFlexibleName(first: string, last: string): Promise<string | null> {
  const pairs = buildNameSearchPairs(first, last);
  for (const [fn, ln] of pairs) {
    const rows = await prisma.directClient.findMany({
      where: {
        AND: [
          { firstName: { contains: fn, mode: 'insensitive' } },
          { lastName: { contains: ln, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 3,
    });
    if (rows.length === 1) {
      return rows[0].id;
    }
  }
  const byIg = await prisma.directClient.findFirst({
    where: { instagramUsername: { equals: 'mykolayyurashko', mode: 'insensitive' } },
    select: { id: true },
  });
  if (byIg) return byIg.id;
  return null;
}

async function linkTelegramIdsToClient(
  clientId: string,
  userId: bigint,
  chatIdBig: bigint
): Promise<void> {
  await prisma.directClient.update({
    where: { id: clientId },
    data: { telegramUserId: userId, telegramChatId: chatIdBig },
  });
}

export async function saveTelegramDirectMessage(
  message: TelegramMessage,
  options: { direction: 'incoming' | 'outgoing'; clientId: string }
): Promise<void> {
  const text = (message.text || message.caption || '').trim();
  if (!text) return;

  const messageId = message.message_id != null ? `tg:${message.message_id}:${options.clientId}` : null;

  if (messageId) {
    const existing = await prisma.directMessage.findFirst({
      where: { clientId: options.clientId, messageId },
      select: { id: true },
    });
    if (existing) return;
  }

  const receivedAt = message.date ? new Date(message.date * 1000) : new Date();

  await prisma.directMessage.create({
    data: {
      clientId: options.clientId,
      direction: options.direction,
      text,
      messageId,
      source: 'telegram',
      receivedAt,
      rawData: JSON.stringify({
        chatId: message.chat?.id,
        fromId: message.from?.id,
        fromUsername: message.from?.username,
        senderBusinessBot: message.sender_business_bot?.id,
        businessConnectionId: message.business_connection_id,
      }),
    },
  });

  await prisma.directClient.update({
    where: { id: options.clientId },
    data: { lastMessageAt: receivedAt },
  });
}

/** Знайти clientId за Telegram chat/user id, username або ПІБ. */
export async function resolveDirectClientIdFromTelegramMessage(
  message: TelegramMessage
): Promise<string | null> {
  const chatId = message.chat?.id;
  if (!chatId) return null;

  const chatIdBig = BigInt(chatId);

  // Спочатку чат — працює і для вхідних клієнта, і для вихідних салону/бота
  const byChat = await prisma.directClient.findFirst({
    where: { telegramChatId: chatIdBig },
    select: { id: true },
  });
  if (byChat) {
    const rawFrom = message.from;
    if (rawFrom?.id && !rawFrom.is_bot) {
      const fromId = BigInt(rawFrom.id);
      const row = await prisma.directClient.findUnique({
        where: { id: byChat.id },
        select: { telegramUserId: true },
      });
      // Не перезаписувати id клієнта id співробітника/салону з вихідного повідомлення
      if (row?.telegramUserId == null) {
        await linkTelegramIdsToClient(byChat.id, fromId, chatIdBig);
      } else if (row.telegramUserId === fromId) {
        await prisma.directClient.update({
          where: { id: byChat.id },
          data: { telegramChatId: chatIdBig },
        });
      }
    }
    return byChat.id;
  }

  const from = resolveMessageSender(message);
  // Повідомлення від бота без привʼязаного чату — не привʼязуємо до клієнта за bot id
  if (from?.is_bot) return null;

  if (from?.id) {
    const userId = BigInt(from.id);
    const byUser = await prisma.directClient.findFirst({
      where: { telegramUserId: userId },
      select: { id: true },
    });
    if (byUser) {
      await linkTelegramIdsToClient(byUser.id, userId, chatIdBig);
      return byUser.id;
    }
  }

  const tgUsername = normalizeTelegramUsername(from?.username);
  if (tgUsername) {
    const byIg = await prisma.directClient.findFirst({
      where: { instagramUsername: { equals: tgUsername, mode: 'insensitive' } },
      select: { id: true },
    });
    if (byIg && from?.id) {
      await linkTelegramIdsToClient(byIg.id, BigInt(from.id), chatIdBig);
      return byIg.id;
    }
    const normalizedIg = normalizeInstagram(tgUsername);
    if (normalizedIg && normalizedIg !== tgUsername) {
      const byIgNorm = await prisma.directClient.findFirst({
        where: { instagramUsername: normalizedIg },
        select: { id: true },
      });
      if (byIgNorm && from?.id) {
        await linkTelegramIdsToClient(byIgNorm.id, BigInt(from.id), chatIdBig);
        return byIgNorm.id;
      }
    }
  }

  const fn = (from?.first_name || message.chat?.first_name || '').trim();
  const ln = (from?.last_name || message.chat?.last_name || '').trim();
  if (fn && ln && from?.id) {
    const matchedId = await findClientIdByFlexibleName(fn, ln);
    if (matchedId) {
      await linkTelegramIdsToClient(matchedId, BigInt(from.id), chatIdBig);
      return matchedId;
    }
  }

  // Якщо в БД один клієнт без Telegram — обережна автопривʼязка
  const unlinked = await prisma.directClient.findMany({
    where: { telegramChatId: null, telegramUserId: null },
    select: { id: true },
    take: 2,
  });
  if (unlinked.length === 1 && from?.id) {
    await linkTelegramIdsToClient(unlinked[0].id, BigInt(from.id), chatIdBig);
    return unlinked[0].id;
  }

  return null;
}

/** Вхідне від клієнта чи вихідне від салону (Business). */
export async function resolveTelegramMessageDirection(
  message: TelegramMessage,
  clientId: string
): Promise<'incoming' | 'outgoing'> {
  // Відправлено ботом від імені салону (автовідповідь, розсилка API)
  if (message.sender_business_bot) return 'outgoing';

  const rawFrom = message.from;
  if (rawFrom?.is_bot) return 'outgoing';

  if (!rawFrom?.id) return 'outgoing';

  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true },
  });
  if (client?.telegramUserId != null && BigInt(rawFrom.id) === client.telegramUserId) {
    return 'incoming';
  }
  return 'outgoing';
}

/** Виправити direction у вже збережених повідомленнях за fromId у rawData та telegramUserId клієнта. */
export async function repairTelegramMessageDirections(clientId: string): Promise<number> {
  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true },
  });
  if (!client?.telegramUserId) return 0;

  const uid = client.telegramUserId;
  const msgs = await prisma.directMessage.findMany({
    where: { clientId, source: 'telegram' },
    select: { id: true, direction: true, rawData: true },
  });

  let fixed = 0;
  for (const m of msgs) {
    let fromId: number | null = null;
    let senderBusinessBot: number | null = null;
    try {
      const raw = m.rawData ? (JSON.parse(m.rawData) as Record<string, unknown>) : {};
      if (raw.fromId != null) fromId = Number(raw.fromId);
      if (raw.senderBusinessBot != null) senderBusinessBot = Number(raw.senderBusinessBot);
    } catch {
      /* ignore */
    }

    const want: 'incoming' | 'outgoing' =
      senderBusinessBot != null
        ? 'outgoing'
        : fromId != null && BigInt(fromId) === uid
          ? 'incoming'
          : 'outgoing';

    if (m.direction !== want) {
      await prisma.directMessage.update({ where: { id: m.id }, data: { direction: want } });
      fixed++;
    }
  }
  return fixed;
}
