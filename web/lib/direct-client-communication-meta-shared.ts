// Лише типи + чисті функції для клієнта (без prisma). Не імпортувати в цей файл серверні модулі.
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
 * Після GET /clients (lightweight) нові об’єкти без Inst/дзвінків — не скидати вже змерджені поля,
 * інакше тихе оновлення та повторні loadClients дають миготіння до communication-meta.
 * Копіюємо з previous лише якщо у incoming поле ще undefined (свіжі дані з API мають пріоритет).
 */
export function mergeIncomingClientsPreservingCommunicationMeta(
  previous: DirectClient[],
  incoming: DirectClient[]
): DirectClient[] {
  const prevById = new Map(previous.map((c) => [c.id, c]));
  return incoming.map((inc) => {
    const old = prevById.get(inc.id);
    if (!old) return inc;
    const out: DirectClient = { ...inc };
    for (const key of DIRECT_CLIENT_COMMUNICATION_META_KEYS) {
      const nk = key as keyof DirectClient;
      if ((inc as Record<string, unknown>)[nk as string] === undefined && (old as Record<string, unknown>)[nk as string] !== undefined) {
        (out as Record<string, unknown>)[nk as string] = (old as Record<string, unknown>)[nk as string];
      }
    }
    return out;
  });
}
