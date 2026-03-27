// web/lib/direct-clients-communication-meta.ts
// Метадані колонок «Переписка» (Inst) та «Дзвінки» для Direct — окремий етап після швидкого списку клієнтів.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isConnectionLevelDbFailure } from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';

/** Поля, які додає enrich і мерджаться у клієнта на клієнті. */
export const DIRECT_CLIENT_COMMUNICATION_META_KEYS = [
  'messagesTotal',
  'chatNeedsAttention',
  'chatStatusName',
  'chatStatusBadgeKey',
  'firstMessageReceivedAt',
  'lastMessageAt',
  'callStatusName',
  'callStatusBadgeKey',
  'callStatusLogs',
  'binotelCallsCount',
  'binotelLatestCallRecordingUrl',
  'binotelLatestCallGeneralID',
  'binotelLatestCallType',
  'binotelLatestCallDisposition',
  'binotelLatestCallStartTime',
] as const;

export type DirectClientCommunicationMetaPatch = Pick<
  DirectClient,
  | 'messagesTotal'
  | 'chatNeedsAttention'
  | 'chatStatusName'
  | 'chatStatusBadgeKey'
  | 'firstMessageReceivedAt'
  | 'lastMessageAt'
  | 'callStatusName'
  | 'callStatusBadgeKey'
  | 'callStatusLogs'
  | 'binotelCallsCount'
  | 'binotelLatestCallRecordingUrl'
  | 'binotelLatestCallGeneralID'
  | 'binotelLatestCallType'
  | 'binotelLatestCallDisposition'
  | 'binotelLatestCallStartTime'
>;

/**
 * Метадані колонки «Переписка» (Inst): messagesTotal, chatNeedsAttention, chatStatusName, ефективне lastMessageAt.
 */
export async function enrichClientsWithChatMeta<T extends { id: string }>(clients: T[]): Promise<T[]> {
  try {
    const ids = clients.map((c) => c.id);
    if (!ids.length) return clients;

    const [totalCounts, lastIncoming, firstIncoming] = await Promise.all([
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, direction: 'incoming' },
        _max: { receivedAt: true },
      }),
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, direction: 'incoming' },
        _min: { receivedAt: true },
      }),
    ]);

    const totalMap = new Map<string, number>();
    for (const r of totalCounts) {
      totalMap.set(r.clientId, (r as any)?._count?._all ?? 0);
    }

    const lastIncomingMap = new Map<string, Date>();
    for (const r of lastIncoming) {
      const dt = (r as any)?._max?.receivedAt as Date | null | undefined;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        lastIncomingMap.set(r.clientId, dt);
      }
    }

    const firstMessageReceivedAtMap = new Map<string, string>();
    for (const r of firstIncoming) {
      const dt = (r as any)?._min?.receivedAt as Date | null | undefined;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        firstMessageReceivedAtMap.set(r.clientId, dt.toISOString());
      }
    }

    const statusIds = Array.from(
      new Set(
        clients
          .map((c) => (c as any).chatStatusId)
          .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      )
    );

    const statuses =
      statusIds.length > 0
        ? await prisma.directChatStatus.findMany({
            where: { id: { in: statusIds } },
            select: { id: true, name: true, badgeKey: true, isActive: true },
          })
        : [];
    const statusMap = new Map<string, { name: string; badgeKey: string; isActive: boolean }>();
    for (const s of statuses)
      statusMap.set(s.id, { name: s.name, badgeKey: (s as any).badgeKey || 'badge_1', isActive: s.isActive });

    return clients.map((c) => {
      const messagesTotal = totalMap.get(c.id) ?? 0;
      const lastIn = lastIncomingMap.get(c.id) ?? null;

      const stId = ((c as any).chatStatusId || '').toString().trim() || '';
      const st = stId ? statusMap.get(stId) : null;

      const checkedAtIso = (c as any).chatStatusCheckedAt as string | undefined;
      const setAtIso = (c as any).chatStatusSetAt as string | undefined;
      const thresholdIso = (checkedAtIso || setAtIso || '').toString().trim();
      const thresholdTs = thresholdIso ? new Date(thresholdIso).getTime() : NaN;

      const chatNeedsAttention = (() => {
        if (!lastIn) return false;
        if (Number.isFinite(thresholdTs)) return lastIn.getTime() > thresholdTs;
        const hasStatus = Boolean(stId);
        return !hasStatus;
      })();

      const firstMessageReceivedAt = firstMessageReceivedAtMap.get(c.id);

      const dbLastDate = (c as any).lastMessageAt ? new Date((c as any).lastMessageAt) : null;
      const maxDate =
        !dbLastDate && !lastIn
          ? null
          : !dbLastDate
            ? lastIn
            : !lastIn
              ? dbLastDate
              : dbLastDate.getTime() >= lastIn.getTime()
                ? dbLastDate
                : lastIn;
      const effectiveLastMessageAt = maxDate ? maxDate.toISOString() : undefined;

      return {
        ...c,
        messagesTotal,
        chatNeedsAttention,
        chatStatusName: st?.name || undefined,
        chatStatusBadgeKey: st?.badgeKey || undefined,
        ...(firstMessageReceivedAt && { firstMessageReceivedAt }),
        lastMessageAt: effectiveLastMessageAt ?? (c as any).lastMessageAt,
      } as T;
    });
  } catch (err) {
    if (isConnectionLevelDbFailure(err)) {
      console.warn(
        '[direct-clients-communication-meta] enrichClientsWithChatMeta: недоступність БД:',
        err instanceof Error ? err.message : err
      );
      throw err;
    }
    console.warn('[direct-clients-communication-meta] enrichClientsWithChatMeta (не критично):', err);
    return clients;
  }
}

/**
 * Колонка «Дзвінки» / статус дзвінка: Binotel + метадані callStatus.
 */
export async function enrichClientsWithCallMeta<T extends { id: string }>(clients: T[]): Promise<T[]> {
  try {
    const ids = clients.map((c) => c.id);
    if (!ids.length) return clients;

    const callStatusIds = Array.from(
      new Set(
        clients.map((c) => (c as any).callStatusId).filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      )
    );

    const [callStatuses, callStatusLogs, binotelCounts, binotelLatestCalls] = await Promise.all([
      callStatusIds.length > 0
        ? prisma.directCallStatus.findMany({
            where: { id: { in: callStatusIds } },
            select: { id: true, name: true, badgeKey: true },
          })
        : [],
      prisma.directClientCallStatusLog.findMany({
        where: { clientId: { in: ids } },
        include: { toStatus: { select: { name: true } } },
        orderBy: { changedAt: 'desc' },
      }),
      prisma.directClientBinotelCall.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids } },
        _count: { id: true },
      }),
      ids.length > 0
        ? (prisma.$queryRaw`
            SELECT DISTINCT ON ("clientId") "clientId", "generalCallID", "callType", "disposition", "startTime", "rawData"
            FROM "direct_client_binotel_calls"
            WHERE "clientId" IN (${Prisma.join(ids)})
            ORDER BY "clientId", "startTime" DESC
          ` as Promise<
            Array<{
              clientId: string | null;
              generalCallID: string;
              callType: string;
              disposition: string;
              startTime: Date;
              rawData: unknown;
            }>
          >)
        : [],
    ]);

    function extractRecordingUrl(raw: unknown): string | null {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const candidates = [
        r.linkToCallRecordInMyBusiness,
        r.linkToCallRecordOverlayInMyBusiness,
        r.recordingUrl,
        r.audio_path,
        r.recordingLink,
        r.recording,
      ];
      for (const v of candidates) {
        if (typeof v === 'string' && v.startsWith('http')) return v;
      }
      return null;
    }

    const binotelLatestRecordingMap = new Map<string, string>();
    const binotelLatestGeneralIdMap = new Map<string, string>();
    const binotelLatestCallTypeMap = new Map<string, string>();
    const binotelLatestCallDispositionMap = new Map<string, string>();
    const binotelLatestCallStartTimeMap = new Map<string, Date>();
    const seenClientIds = new Set<string>();
    for (const row of binotelLatestCalls) {
      if (!row.clientId || seenClientIds.has(row.clientId)) continue;
      seenClientIds.add(row.clientId);
      const url = extractRecordingUrl(row.rawData);
      if (url) binotelLatestRecordingMap.set(row.clientId, url);
      const gid = (row as { generalCallID?: string }).generalCallID;
      if (gid && !gid.startsWith('gen-')) {
        binotelLatestGeneralIdMap.set(row.clientId, gid);
      }
      const ct = (row as { callType?: string }).callType;
      if (ct) binotelLatestCallTypeMap.set(row.clientId, ct);
      const disp = (row as { disposition?: string }).disposition;
      if (disp) binotelLatestCallDispositionMap.set(row.clientId, disp);
      const st = (row as { startTime?: Date }).startTime;
      if (st) binotelLatestCallStartTimeMap.set(row.clientId, st);
    }

    const callStatusMap = new Map<string, { name: string; badgeKey: string }>();
    for (const s of callStatuses) {
      callStatusMap.set(s.id, { name: s.name, badgeKey: (s as any).badgeKey || 'badge_1' });
    }

    const logsByClient = new Map<string, Array<{ statusName: string; changedAt: string }>>();
    for (const log of callStatusLogs) {
      const statusName = (log as any).toStatus?.name ?? '—';
      const arr = logsByClient.get(log.clientId) ?? [];
      if (arr.length < 50) arr.push({ statusName, changedAt: log.changedAt.toISOString() });
      logsByClient.set(log.clientId, arr);
    }

    const binotelCountMap = new Map<string, number>();
    for (const r of binotelCounts) {
      if (r.clientId) binotelCountMap.set(r.clientId, (r as any)._count?.id ?? 0);
    }

    return clients.map((c) => {
      const callStId = ((c as any).callStatusId || '').toString().trim() || '';
      const callSt = callStId ? callStatusMap.get(callStId) : null;
      const callLogs = logsByClient.get(c.id) ?? [];
      const binotelCallsCount = binotelCountMap.get(c.id) ?? 0;
      const binotelLatestCallRecordingUrl = binotelLatestRecordingMap.get(c.id) ?? null;
      const binotelLatestCallGeneralID = binotelLatestGeneralIdMap.get(c.id) ?? null;
      const binotelLatestCallType = binotelLatestCallTypeMap.get(c.id) ?? null;
      const binotelLatestCallDisposition = binotelLatestCallDispositionMap.get(c.id) ?? null;
      const binotelLatestCallStartTime = binotelLatestCallStartTimeMap.get(c.id) ?? null;
      return {
        ...c,
        callStatusName: callSt?.name || undefined,
        callStatusBadgeKey: callSt?.badgeKey || undefined,
        callStatusLogs: callLogs.length > 0 ? callLogs : undefined,
        binotelCallsCount: binotelCallsCount > 0 ? binotelCallsCount : undefined,
        binotelLatestCallRecordingUrl: binotelLatestCallRecordingUrl || undefined,
        binotelLatestCallGeneralID: binotelLatestCallGeneralID || undefined,
        binotelLatestCallType: binotelLatestCallType || undefined,
        binotelLatestCallDisposition: binotelLatestCallDisposition || undefined,
        binotelLatestCallStartTime:
          binotelLatestCallStartTime?.toISOString?.() ||
          (binotelLatestCallStartTime ? String(binotelLatestCallStartTime) : undefined),
      } as T;
    });
  } catch (err) {
    if (isConnectionLevelDbFailure(err)) {
      console.warn(
        '[direct-clients-communication-meta] enrichClientsWithCallMeta: недоступність БД:',
        err instanceof Error ? err.message : err
      );
      throw err;
    }
    console.warn('[direct-clients-communication-meta] enrichClientsWithCallMeta (не критично):', err);
    return clients;
  }
}

/** Chat, потім дзвінки — та сама послідовність, що була в GET /clients. */
export async function enrichDirectClientsCommunicationMeta(clients: DirectClient[]): Promise<DirectClient[]> {
  const afterChat = await enrichClientsWithChatMeta(clients);
  return enrichClientsWithCallMeta(afterChat);
}

export function pickCommunicationMetaPatch(
  enriched: DirectClient
): DirectClientCommunicationMetaPatch {
  const out: Partial<DirectClientCommunicationMetaPatch> = {};
  for (const key of DIRECT_CLIENT_COMMUNICATION_META_KEYS) {
    const v = (enriched as any)[key];
    if (v !== undefined) (out as any)[key] = v;
  }
  return out as DirectClientCommunicationMetaPatch;
}

export function buildCommunicationMetaById(enrichedClients: DirectClient[]): Record<string, DirectClientCommunicationMetaPatch> {
  const byId: Record<string, DirectClientCommunicationMetaPatch> = {};
  for (const c of enrichedClients) {
    byId[c.id] = pickCommunicationMetaPatch(c);
  }
  return byId;
}
