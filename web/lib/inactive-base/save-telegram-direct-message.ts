// web/lib/inactive-base/save-telegram-direct-message.ts
// Зберегти вхідне/вихідне Telegram-повідомлення в DirectMessage.

import { prisma } from '@/lib/prisma';
import type { TelegramMessage } from '@/lib/telegram/types';

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

/** Знайти clientId за Telegram chat/user id. */
export async function resolveDirectClientIdFromTelegramMessage(
  message: TelegramMessage
): Promise<string | null> {
  const from = message.from;
  const chatId = message.chat?.id;
  if (!from?.id || !chatId || from.is_bot) return null;

  const { prisma } = await import('@/lib/prisma');
  const userId = BigInt(from.id);
  const chatIdBig = BigInt(chatId);

  const byUser = await prisma.directClient.findFirst({
    where: { telegramUserId: userId },
    select: { id: true },
  });
  if (byUser) {
    await prisma.directClient.update({
      where: { id: byUser.id },
      data: { telegramChatId: chatIdBig, telegramUserId: userId },
    });
    return byUser.id;
  }

  const byChat = await prisma.directClient.findFirst({
    where: { telegramChatId: chatIdBig },
    select: { id: true },
  });
  if (byChat) {
    await prisma.directClient.update({
      where: { id: byChat.id },
      data: { telegramUserId: userId },
    });
    return byChat.id;
  }

  // Якщо в БД один клієнт без Telegram — обережна автопривʼязка (як у webhook раніше)
  const unlinked = await prisma.directClient.findMany({
    where: { telegramChatId: null, telegramUserId: null },
    select: { id: true },
    take: 2,
  });
  if (unlinked.length === 1) {
    await prisma.directClient.update({
      where: { id: unlinked[0].id },
      data: { telegramUserId: userId, telegramChatId: chatIdBig },
    });
    return unlinked[0].id;
  }

  return null;
}
