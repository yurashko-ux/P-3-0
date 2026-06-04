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
  const from = resolveMessageSender(message);
  if (from?.is_bot) return null;

  const byChat = await prisma.directClient.findFirst({
    where: { telegramChatId: chatIdBig },
    select: { id: true },
  });
  if (byChat) {
    if (from?.id) {
      await linkTelegramIdsToClient(byChat.id, BigInt(from.id), chatIdBig);
    }
    return byChat.id;
  }

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
  const from = resolveMessageSender(message);
  if (!from?.id) return 'incoming';

  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true },
  });
  if (client?.telegramUserId != null && BigInt(from.id) === client.telegramUserId) {
    return 'incoming';
  }
  return 'outgoing';
}
