// web/lib/direct-clients-channel-chat-meta.ts
// Метадані переписки за каналом (Inst / Telegram) — та сама логіка, що enrichClientsWithChatMeta.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isConnectionLevelDbFailure } from '@/lib/direct-store';
import {
  CHANNEL_CHAT_STATUS_FIELDS,
  type DirectChatChannel,
  sourcesWhereClause,
} from '@/lib/direct-channel-chat';

export type ChannelChatMetaPatch = {
  messagesTotal?: number;
  chatNeedsAttention?: boolean;
  chatStatusName?: string;
  chatStatusBadgeKey?: string;
  lastMessageAt?: string;
};

function prefixKeys(meta: ChannelChatMetaPatch, channel: DirectChatChannel): Record<string, unknown> {
  if (channel === 'instagram') {
    return {
      messagesTotal: meta.messagesTotal,
      chatNeedsAttention: meta.chatNeedsAttention,
      chatStatusName: meta.chatStatusName,
      chatStatusBadgeKey: meta.chatStatusBadgeKey,
      lastMessageAt: meta.lastMessageAt,
    };
  }
  return {
    telegramMessagesTotal: meta.messagesTotal,
    telegramChatNeedsAttention: meta.chatNeedsAttention,
    telegramChatStatusName: meta.chatStatusName,
    telegramChatStatusBadgeKey: meta.chatStatusBadgeKey,
    telegramLastMessageAt: meta.lastMessageAt,
  };
}

/**
 * Метадані колонки переписки для каналу: лічильник, needsAttention, назва статусу.
 */
export async function enrichClientsWithChannelChatMeta<T extends { id: string }>(
  clients: T[],
  channel: DirectChatChannel
): Promise<T[]> {
  try {
    const ids = clients.map((c) => c.id);
    if (!ids.length) return clients;

    const sourceFilter = sourcesWhereClause(channel);
    const fields = CHANNEL_CHAT_STATUS_FIELDS[channel];
    const statusField = fields.statusId;
    const checkedField = fields.checkedAt;
    const setField = fields.setAt;

    const [totalCounts, lastIncoming] = await Promise.all([
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, ...sourceFilter },
        _count: { _all: true },
      }),
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, direction: 'incoming', ...sourceFilter },
        _max: { receivedAt: true },
      }),
    ]);

    const totalMap = new Map<string, number>();
    for (const r of totalCounts) {
      totalMap.set(r.clientId, (r as { _count?: { _all?: number } })?._count?._all ?? 0);
    }

    const lastIncomingMap = new Map<string, Date>();
    for (const r of lastIncoming) {
      const dt = (r as { _max?: { receivedAt?: Date | null } })?._max?.receivedAt;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        lastIncomingMap.set(r.clientId, dt);
      }
    }

    const statusIds = Array.from(
      new Set(
        clients
          .map((c) => (c as Record<string, unknown>)[statusField])
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      )
    );

    const statuses =
      statusIds.length > 0
        ? await prisma.directChatStatus.findMany({
            where: { id: { in: statusIds } },
            select: { id: true, name: true, badgeKey: true, isActive: true },
          })
        : [];
    const statusMap = new Map(statuses.map((s) => [s.id, s]));

    return clients.map((c) => {
      const messagesTotal = totalMap.get(c.id) ?? 0;
      const lastIn = lastIncomingMap.get(c.id) ?? null;
      const rec = c as Record<string, unknown>;
      const stId = (rec[statusField] || '').toString().trim();
      const st = stId ? statusMap.get(stId) : null;
      const checkedAtIso = (rec[checkedField] as string | Date | undefined)?.toString?.() || '';
      const setAtIso = (rec[setField] as string | Date | undefined)?.toString?.() || '';
      const thresholdIso = (checkedAtIso || setAtIso || '').trim();
      const thresholdTs = thresholdIso ? new Date(thresholdIso).getTime() : NaN;

      const chatNeedsAttention = (() => {
        if (!lastIn) return false;
        if (Number.isFinite(thresholdTs)) return lastIn.getTime() > thresholdTs;
        return !Boolean(stId);
      })();

      const maxDate = lastIn;
      const meta: ChannelChatMetaPatch = {
        messagesTotal,
        chatNeedsAttention,
        chatStatusName: st?.name,
        chatStatusBadgeKey: (st as { badgeKey?: string })?.badgeKey,
        lastMessageAt: maxDate ? maxDate.toISOString() : undefined,
      };

      return { ...c, ...prefixKeys(meta, channel) } as T;
    });
  } catch (err) {
    if (isConnectionLevelDbFailure(err)) throw err;
    console.warn(`[direct-clients-channel-chat-meta] enrich ${channel} (не критично):`, err);
    return clients;
  }
}

/** Обидва канали для неактивної бази / розширених таблиць. */
export async function enrichClientsWithInstagramAndTelegramChatMeta<T extends { id: string }>(
  clients: T[]
): Promise<T[]> {
  let result = await enrichClientsWithChannelChatMeta(clients, 'instagram');
  result = await enrichClientsWithChannelChatMeta(result, 'telegram');
  return result;
}
