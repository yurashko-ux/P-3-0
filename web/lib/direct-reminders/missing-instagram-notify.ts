// Ручне прохання вказати Instagram: кнопка в редагуванні клієнта з Altegio ID.

import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { kvWrite } from '@/lib/kv';
import { sendMessage } from '@/lib/telegram/api';
import { TELEGRAM_ENV } from '@/lib/telegram/env';

function isUnknownClientName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    !name ||
    name === "Невідоме ім'я" ||
    name === 'Невідомий клієнт' ||
    lower === "невідоме ім'я" ||
    lower === 'невідомий клієнт' ||
    lower.startsWith('невідом') ||
    lower === 'unknown' ||
    lower === 'немає імені'
  );
}

export async function sendMissingInstagramTelegramRequest(params: {
  altegioClientId: number;
  fallbackName?: string;
  fallbackPhone?: string | null;
}): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  const altegioClientId = params.altegioClientId;
  if (!Number.isFinite(altegioClientId)) {
    return { ok: false, error: 'Немає Altegio ID' };
  }

  const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
  const client = await getDirectClientByAltegioId(altegioClientId);
  if (!client) {
    return { ok: false, error: `Клієнта з Altegio ID ${altegioClientId} немає в Direct` };
  }

  const username = client.instagramUsername || '';
  if (hasNormalInstagramUsername(username)) {
    return { ok: false, error: `У клієнта вже є Instagram: ${username}` };
  }

  const clientName = (
    params.fallbackName ||
    [client.firstName, client.lastName].filter(Boolean).join(' ')
  ).trim();
  if (isUnknownClientName(clientName)) {
    return { ok: false, error: 'У картки немає імені, повідомлення не надіслано' };
  }

  const clientPhone = (params.fallbackPhone || client.phone || 'не вказано').trim() || 'не вказано';
  const message =
    `⚠️ <b>Відсутній Instagram username</b>\n\n` +
    `Клієнт: <b>${clientName}</b>\n` +
    `Телефон: ${clientPhone}\n` +
    `Altegio ID: <code>${altegioClientId}</code>\n\n` +
    `📝 <b>Відправте Instagram username у відповідь на це повідомлення</b>\n` +
    `(наприклад: @username або username)\n\n` +
    `Або відправте "ні", якщо у клієнта немає Instagram акаунту.\n\n` +
    `Або додайте Instagram username для цього клієнта в Altegio.`;

  const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
  const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');

  let mykolayChatId = await getMykolayChatId();
  if (!mykolayChatId) {
    const registeredChats = await listRegisteredChats();
    const mykolayChat = registeredChats.find((chat) => {
      const chatUsername = chat.username?.toLowerCase().replace('@', '') || '';
      return chatUsername === 'mykolay007';
    });
    mykolayChatId = mykolayChat?.chatId;
  }

  const adminChatIds = await getAdminChatIds();
  const chatIds = [
    ...(mykolayChatId ? [mykolayChatId] : []),
    ...adminChatIds.filter((id) => id !== mykolayChatId),
  ];
  if (chatIds.length === 0) {
    return { ok: false, error: 'Немає Telegram-чату, куди надіслати прохання' };
  }

  const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'Не задано токен бота' };
  }

  let sentTo = 0;
  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, message, {}, botToken);
      sentTo += 1;
      console.log(`[missing-instagram] Ручне прохання для Altegio ${altegioClientId} у чат ${chatId}`);
      try {
        await kvWrite.lpush(
          'telegram:missing-instagram:outgoing',
          JSON.stringify({
            type: 'outgoing',
            direction: 'outgoing',
            sentAt: new Date().toISOString(),
            chatId,
            altegioClientId,
            clientName,
            message,
            source: 'manual-client-edit',
          }),
        );
        await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
      } catch (logErr) {
        console.error('[missing-instagram] Не вдалося залогувати вихідне повідомлення:', logErr);
      }
    } catch (err) {
      console.error(`[missing-instagram] Помилка відправки в чат ${chatId}:`, err);
    }
  }

  if (sentTo === 0) {
    return { ok: false, error: 'Telegram не прийняв повідомлення' };
  }

  try {
    const { prisma } = await import('@/lib/prisma');
    await prisma.directClient.update({
      where: { id: client.id },
      data: { telegramNotificationSent: true },
    });
  } catch (err) {
    console.error('[missing-instagram] Не вдалося оновити telegramNotificationSent:', err);
  }

  return { ok: true, sentTo };
}
