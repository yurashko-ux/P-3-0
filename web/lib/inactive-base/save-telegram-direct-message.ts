// web/lib/inactive-base/save-telegram-direct-message.ts
// Зберегти вхідне/вихідне Telegram-повідомлення в DirectMessage.

import { prisma } from '@/lib/prisma';
import { normalizeInstagram } from '@/lib/normalize';
import { buildNameSearchPairs } from '@/lib/inactive-base/telegram-name-match';
import {
  ensureBusinessUserIdCached,
  getStoredBusinessUserId,
} from '@/lib/inactive-base/telegram-business';
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
  const businessUserId = await ensureBusinessUserIdCached();
  if (businessUserId != null && userId === businessUserId) {
    await prisma.directClient.update({
      where: { id: clientId },
      data: { telegramChatId: chatIdBig },
    });
    return;
  }
  await prisma.directClient.update({
    where: { id: clientId },
    data: { telegramUserId: userId, telegramChatId: chatIdBig },
  });
}

/** Чи можна записати fromId як telegramUserId клієнта (не id салону). */
async function isClientTelegramFromId(fromId: bigint, chatIdBig: bigint): Promise<boolean> {
  const businessUserId = await ensureBusinessUserIdCached();
  if (businessUserId != null && fromId === businessUserId) return false;
  // У private Business-чаті вхідні від клієнта: from.id збігається з chat.id
  if (fromId === chatIdBig) return true;
  return businessUserId == null || fromId !== businessUserId;
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
      select: { id: true, direction: true },
    });
    if (existing) {
      if (existing.direction !== options.direction) {
        await prisma.directMessage.update({
          where: { id: existing.id },
          data: { direction: options.direction },
        });
      }
      return;
    }
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
      const businessUserId = await ensureBusinessUserIdCached();
      const userIdLooksWrong =
        businessUserId != null &&
        row?.telegramUserId != null &&
        row.telegramUserId === businessUserId;
      if (await isClientTelegramFromId(fromId, chatIdBig)) {
        if (row?.telegramUserId == null || userIdLooksWrong) {
          await linkTelegramIdsToClient(byChat.id, fromId, chatIdBig);
        } else if (row.telegramUserId === fromId) {
          await prisma.directClient.update({
            where: { id: byChat.id },
            data: { telegramChatId: chatIdBig },
          });
        }
      } else {
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
    if (!(await isClientTelegramFromId(userId, chatIdBig))) {
      return null;
    }
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

  const businessUserId = await ensureBusinessUserIdCached();
  if (businessUserId != null && rawFrom?.id && BigInt(rawFrom.id) === businessUserId) {
    return 'outgoing';
  }

  const chatId = message.chat?.id;
  if (
    chatId &&
    rawFrom?.id &&
    isDirectPrivateChat(message.chat) &&
    BigInt(rawFrom.id) === BigInt(chatId)
  ) {
    return 'incoming';
  }

  if (!rawFrom?.id) return 'outgoing';

  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true, telegramChatId: true },
  });
  const clientUserId = client?.telegramUserId;
  const userIdIsValidClient =
    clientUserId != null &&
    (businessUserId == null || clientUserId !== businessUserId);
  if (userIdIsValidClient && BigInt(rawFrom.id) === clientUserId) {
    return 'incoming';
  }
  if (
    client?.telegramChatId != null &&
    BigInt(rawFrom.id) === client.telegramChatId &&
    (businessUserId == null || BigInt(rawFrom.id) !== businessUserId)
  ) {
    return 'incoming';
  }
  return 'outgoing';
}

/** Виправити telegramUserId, якщо помилково записано id салону замість клієнта. */
export async function repairTelegramClientUserId(
  clientId: string
): Promise<{ fixed: boolean; previousUserId: string | null; newUserId: string | null }> {
  const businessUserId = await ensureBusinessUserIdCached();
  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true, telegramChatId: true },
  });
  if (!client) {
    return { fixed: false, previousUserId: null, newUserId: null };
  }

  const wrong =
    businessUserId != null &&
    client.telegramUserId != null &&
    client.telegramUserId === businessUserId;
  if (!wrong) {
    return {
      fixed: false,
      previousUserId: client.telegramUserId?.toString() ?? null,
      newUserId: client.telegramUserId?.toString() ?? null,
    };
  }

  let newUserId: bigint | null = null;
  if (
    client.telegramChatId != null &&
    client.telegramChatId !== businessUserId
  ) {
    newUserId = client.telegramChatId;
  }

  if (newUserId == null) {
    const msgs = await prisma.directMessage.findMany({
      where: { clientId, source: 'telegram' },
      select: { rawData: true },
      take: 50,
    });
    for (const m of msgs) {
      try {
        const raw = m.rawData ? (JSON.parse(m.rawData) as Record<string, unknown>) : {};
        const fromId = raw.fromId != null ? Number(raw.fromId) : null;
        const chatId = raw.chatId != null ? Number(raw.chatId) : null;
        if (fromId != null && businessUserId != null && BigInt(fromId) !== businessUserId) {
          newUserId = BigInt(fromId);
          break;
        }
        if (chatId != null && businessUserId != null && BigInt(chatId) !== businessUserId) {
          newUserId = BigInt(chatId);
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (newUserId == null || newUserId === client.telegramUserId) {
    return {
      fixed: false,
      previousUserId: client.telegramUserId?.toString() ?? null,
      newUserId: client.telegramUserId?.toString() ?? null,
    };
  }

  await prisma.directClient.update({
    where: { id: clientId },
    data: { telegramUserId: newUserId },
  });

  return {
    fixed: true,
    previousUserId: client.telegramUserId.toString(),
    newUserId: newUserId.toString(),
  };
}

/** Виправити direction у вже збережених повідомленнях за fromId у rawData та telegramUserId клієнта. */
export async function repairTelegramMessageDirections(clientId: string): Promise<number> {
  await repairTelegramClientUserId(clientId);

  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { telegramUserId: true, telegramChatId: true },
  });

  const businessUserId = await ensureBusinessUserIdCached();
  const uid =
    client?.telegramUserId != null &&
    (businessUserId == null || client.telegramUserId !== businessUserId)
      ? client.telegramUserId
      : client?.telegramChatId ?? null;
  if (uid == null) return 0;
  const msgs = await prisma.directMessage.findMany({
    where: { clientId, source: 'telegram' },
    select: { id: true, direction: true, rawData: true },
  });

  let fixed = 0;
  for (const m of msgs) {
    let fromId: number | null = null;
    let chatId: number | null = null;
    let senderBusinessBot: number | null = null;
    try {
      const raw = m.rawData ? (JSON.parse(m.rawData) as Record<string, unknown>) : {};
      if (raw.fromId != null) fromId = Number(raw.fromId);
      if (raw.chatId != null) chatId = Number(raw.chatId);
      if (raw.senderBusinessBot != null) senderBusinessBot = Number(raw.senderBusinessBot);
    } catch {
      /* ignore */
    }

    const bizId = businessUserId;
    const want: 'incoming' | 'outgoing' =
      senderBusinessBot != null
        ? 'outgoing'
        : bizId != null && fromId != null && BigInt(fromId) === bizId
          ? 'outgoing'
          : chatId != null && fromId != null && BigInt(fromId) === BigInt(chatId)
            ? 'incoming'
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

function parseKvLogEntry(raw: unknown): Record<string, unknown> | null {
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

const KV_BACKFILL_DONE_PREFIX = 'inactive-base:telegram:kv-backfill-done:';

export async function isTelegramKvBackfillDone(clientId: string): Promise<boolean> {
  try {
    const { kvRead } = await import('@/lib/kv');
    const raw = await kvRead.getRaw(`${KV_BACKFILL_DONE_PREFIX}${clientId}`);
    return Boolean(raw && String(raw).includes('1'));
  } catch {
    return false;
  }
}

export async function markTelegramKvBackfillDone(clientId: string): Promise<void> {
  try {
    const { kvWrite } = await import('@/lib/kv');
    await kvWrite.setRaw(`${KV_BACKFILL_DONE_PREFIX}${clientId}`, JSON.stringify('1'));
  } catch {
    /* ignore */
  }
}

/** Легка синхронізація перед читанням історії (без повторного повного KV-скану). */
export async function syncTelegramMessagesIfNeeded(
  clientId: string,
  client: { telegramChatId: bigint | null; telegramUserId: bigint | null },
  options: { force?: boolean } = {}
): Promise<{
  repairedClientUserId: Awaited<ReturnType<typeof repairTelegramClientUserId>> | null;
  repairedDirections: number;
  backfilledFromKv: number;
  skipped: boolean;
}> {
  const force = options.force === true;
  const businessUserId = await getStoredBusinessUserId();
  const needsUserIdFix =
    force ||
    (businessUserId != null &&
      client.telegramUserId != null &&
      client.telegramUserId === businessUserId);
  let backfillDone = force ? false : await isTelegramKvBackfillDone(clientId);

  if (!backfillDone && !needsUserIdFix && client.telegramChatId != null) {
    const existingCount = await prisma.directMessage.count({
      where: { clientId, source: 'telegram' },
    });
    if (existingCount >= 3) {
      await markTelegramKvBackfillDone(clientId);
      backfillDone = true;
    }
  }

  if (!needsUserIdFix && backfillDone) {
    return {
      repairedClientUserId: null,
      repairedDirections: 0,
      backfilledFromKv: 0,
      skipped: true,
    };
  }

  let repairedClientUserId: Awaited<ReturnType<typeof repairTelegramClientUserId>> | null =
    null;
  let backfilledFromKv = 0;

  if (needsUserIdFix) {
    await ensureBusinessUserIdCached();
    repairedClientUserId = await repairTelegramClientUserId(clientId);
  }

  if (!backfillDone && client.telegramChatId != null) {
    backfilledFromKv = await backfillTelegramMessagesFromKvForClient(
      clientId,
      client.telegramChatId
    );
    await markTelegramKvBackfillDone(clientId);
  }

  const repairedDirections =
    needsUserIdFix || backfilledFromKv > 0
      ? await repairTelegramMessageDirections(clientId)
      : 0;

  return {
    repairedClientUserId,
    repairedDirections,
    backfilledFromKv,
    skipped: false,
  };
}

/** Дозаписати business_message з KV-логу webhook (якщо не зберегли раніше). */
export async function backfillTelegramMessagesFromKvForClient(
  clientId: string,
  chatId: bigint,
  options: { logScanLimit?: number } = {}
): Promise<number> {
  const logScanLimit = options.logScanLimit ?? 80;
  const { kvRead } = await import('@/lib/kv');
  const rawLog = await kvRead.lrange('telegram:direct-reminders:log', 0, logScanLimit - 1);

  const existingRows = await prisma.directMessage.findMany({
    where: { clientId, source: 'telegram', messageId: { not: null } },
    select: { messageId: true },
  });
  const existingMessageIds = new Set(
    existingRows.map((r) => r.messageId).filter((id): id is string => Boolean(id))
  );

  const seenMessageIds = new Set<number>();
  let saved = 0;

  for (const raw of rawLog) {
    const entry = parseKvLogEntry(raw);
    if (!entry?.fullUpdate || typeof entry.fullUpdate !== 'string') continue;

    let update: Record<string, unknown>;
    try {
      update = JSON.parse(entry.fullUpdate) as Record<string, unknown>;
    } catch {
      continue;
    }

    const bm = (update.business_message ?? update.edited_business_message) as
      | TelegramMessage
      | undefined;
    if (!bm?.chat?.id || BigInt(bm.chat.id) !== chatId) continue;

    const text = (bm.text || bm.caption || '').trim();
    if (!text) continue;

    const mid = bm.message_id;
    if (mid != null) {
      if (seenMessageIds.has(mid)) continue;
      seenMessageIds.add(mid);
      const msgKey = `tg:${mid}:${clientId}`;
      if (existingMessageIds.has(msgKey)) continue;
    }

    const direction = await resolveTelegramMessageDirection(bm, clientId);
    await saveTelegramDirectMessage(bm, { direction, clientId });
    saved++;
  }

  if (saved > 0) {
    console.log(
      `[save-telegram-direct-message] KV backfill: clientId=${clientId} chatId=${chatId} saved=${saved}`
    );
  }
  return saved;
}
