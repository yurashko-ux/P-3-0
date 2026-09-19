// web/lib/direct/recover-instagram-from-messages-run.ts
// Масове збереження реального Instagram з direct_messages.rawData у direct_clients.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { normalizeInstagram } from '@/lib/normalize';
import { getEnvValue } from '@/lib/env';
import {
  getDirectClient,
  getDirectClientByInstagram,
  getInstagramHandleFromClientMessages,
  getSubscriberIdFromClientMessages,
  findRealInstagramFromSiblingBySubscriber,
  moveClientHistory,
  deleteDirectClient,
  saveDirectClient,
} from '@/lib/direct-store';

/** Клієнти без реального IG у картці, але з перепискою ManyChat. */
export const RECOVER_IG_FROM_MESSAGES_WHERE: Prisma.DirectClientWhereInput = {
  OR: [
    { instagramUsername: { startsWith: '__no_ig__' } },
    { instagramUsername: { startsWith: 'altegio_' } },
    { instagramUsername: { startsWith: 'missing_instagram_' } },
    { instagramUsername: { startsWith: 'no_instagram_' } },
    { instagramUsername: { startsWith: 'binotel_' } },
    { instagramUsername: 'NO INSTAGRAM' },
  ],
  messages: { some: {} },
};

export type RecoverOneInstagramResult = {
  recovered: boolean;
  clientId: string;
  oldUsername?: string | null;
  newUsername?: string;
  reason?: string;
  mergedLead?: boolean;
  source?: 'rawData' | 'sibling_subscriber' | 'manychat_getInfo';
  occupiedClientId?: string | null;
  occupiedAltegioClientId?: number | null;
};

function getManyChatApiKey(): string | null {
  const key = getEnvValue(
    'MANYCHAT_API_KEY',
    'ManyChat_API_Key',
    'MANYCHAT_API_TOKEN',
    'MC_API_KEY',
    'MANYCHAT_APIKEY',
  );
  const t = typeof key === 'string' ? key.trim() : '';
  return t ? t : null;
}

/** ManyChat getInfo → ig_username (коли в rawData немає ніка). */
async function fetchInstagramFromManychatGetInfo(subscriberId: string): Promise<string | null> {
  const apiKey = getManyChatApiKey();
  if (!apiKey) return null;
  try {
    const url = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn('[recover-instagram] getInfo не ок', { status: res.status, subscriberId });
      return null;
    }
    const data = (await res.json().catch(() => null)) as any;
    const node = data?.data ?? data;
    const candidates = [
      node?.ig_username,
      node?.instagram_username,
      node?.username,
      node?.handle,
    ];
    for (const c of candidates) {
      if (typeof c !== 'string') continue;
      const n = normalizeInstagram(c);
      if (n && hasNormalInstagramUsername(n)) return n;
    }
  } catch (err) {
    console.warn('[recover-instagram] getInfo error:', err);
  }
  return null;
}

/**
 * Відновити реальний Instagram для однієї картки.
 * Джерела (по IG/subscriber, НЕ по кириличному ПІБ):
 * 1) rawData повідомлень (ig_username / username)
 * 2) sibling-лід з тим самим subscriber_id і реальним IG
 * 3) ManyChat getInfo(subscriber_id)
 */
export async function recoverInstagramUsernameForClient(
  clientId: string,
): Promise<RecoverOneInstagramResult> {
  const id = String(clientId || '').trim();
  if (!id) return { recovered: false, clientId: id, reason: 'empty_id' };

  const row = await prisma.directClient.findUnique({
    where: { id },
    select: {
      id: true,
      instagramUsername: true,
      firstName: true,
      lastName: true,
      altegioClientId: true,
    },
  });
  if (!row) return { recovered: false, clientId: id, reason: 'not_found' };

  const oldUsername = row.instagramUsername;
  if (hasNormalInstagramUsername(oldUsername)) {
    return { recovered: false, clientId: id, oldUsername, reason: 'already_normal' };
  }

  let recoveredHandle: string | null = await getInstagramHandleFromClientMessages(id);
  let source: RecoverOneInstagramResult['source'] = recoveredHandle ? 'rawData' : undefined;
  let siblingToMerge: string | null = null;

  if (!recoveredHandle) {
    const sibling = await findRealInstagramFromSiblingBySubscriber(id);
    if (sibling?.handle) {
      recoveredHandle = sibling.handle;
      siblingToMerge = sibling.siblingClientId;
      source = 'sibling_subscriber';
    }
  }

  if (!recoveredHandle) {
    const sid = await getSubscriberIdFromClientMessages(id);
    if (sid) {
      const fromApi = await fetchInstagramFromManychatGetInfo(sid);
      if (fromApi) {
        recoveredHandle = fromApi;
        source = 'manychat_getInfo';
      }
    }
  }

  if (!recoveredHandle) {
    return { recovered: false, clientId: id, oldUsername, reason: 'no_handle_in_messages' };
  }

  const newNorm = normalizeInstagram(recoveredHandle) || recoveredHandle;
  const occupied = await getDirectClientByInstagram(newNorm);
  let mergedLead = false;

  const hasAltegioId = (v: unknown): boolean => {
    if (v == null || v === '') return false;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    // ВАЖЛИВО: Number(null) === 0 і isFinite(0) — інакше лід без Altegio помилково «має» Altegio
    return Number.isFinite(n) && n > 0;
  };

  if (occupied && occupied.id !== id) {
    const currentHasAltegio = hasAltegioId(row.altegioClientId);
    const occupiedHasAltegio = hasAltegioId(occupied.altegioClientId);
    if (currentHasAltegio && !occupiedHasAltegio) {
      const moved = await moveClientHistory(occupied.id!, id);
      await deleteDirectClient(occupied.id!);
      mergedLead = true;
      console.log('[recover-instagram] merged lead into altegio client', {
        keptId: id,
        removedLeadId: occupied.id,
        movedMessages: moved.movedMessages,
        newIg: newNorm,
      });
    } else if (!currentHasAltegio && occupiedHasAltegio) {
      // Ця картка — лід без Altegio; реальний IG уже на Altegio-картці — зливаємо сюди історію туди
      const moved = await moveClientHistory(id, occupied.id!);
      await deleteDirectClient(id);
      console.log('[recover-instagram] merged orphan into occupied altegio', {
        removedId: id,
        keptId: occupied.id,
        movedMessages: moved.movedMessages,
      });
      return {
        recovered: true,
        clientId: occupied.id!,
        oldUsername,
        newUsername: newNorm,
        reason: 'merged_into_existing',
        mergedLead: true,
        source,
      };
    } else if (!currentHasAltegio && !occupiedHasAltegio) {
      // Два ліди: залишаємо occupied (вже з реальним IG), переносимо історію з placeholder-картки
      const moved = await moveClientHistory(id, occupied.id!);
      await deleteDirectClient(id);
      console.log('[recover-instagram] merged placeholder lead into IG lead', {
        removedId: id,
        keptId: occupied.id,
        movedMessages: moved.movedMessages,
      });
      return {
        recovered: true,
        clientId: occupied.id!,
        oldUsername,
        newUsername: newNorm,
        reason: 'merged_into_ig_lead',
        mergedLead: true,
        source,
      };
    } else {
      // Обидві з Altegio — не вгадуємо автоматично
      return {
        recovered: false,
        clientId: id,
        oldUsername,
        newUsername: newNorm,
        reason: 'duplicate',
        source,
        occupiedClientId: occupied.id,
        occupiedAltegioClientId: occupied.altegioClientId ?? null,
      };
    }
  }

  // Sibling з тим самим subscriber — переносимо його історію, якщо ще існує
  if (siblingToMerge && siblingToMerge !== id) {
    try {
      const still = await getDirectClient(siblingToMerge);
      if (still?.id) {
        const moved = await moveClientHistory(siblingToMerge, id);
        await deleteDirectClient(siblingToMerge);
        mergedLead = true;
        console.log('[recover-instagram] merged sibling by subscriber', {
          keptId: id,
          removedLeadId: siblingToMerge,
          movedMessages: moved.movedMessages,
        });
      }
    } catch (mergeSiblingErr) {
      console.warn('[recover-instagram] sibling merge failed:', mergeSiblingErr);
    }
  }

  const directClient = await getDirectClient(id);
  if (!directClient) return { recovered: false, clientId: id, oldUsername, reason: 'reload_failed' };

  await saveDirectClient(
    {
      ...directClient,
      instagramUsername: newNorm,
      updatedAt: new Date().toISOString(),
    },
    'recover-instagram-from-messages',
    { source: source || 'messages-rawData', oldUsername },
    { touchUpdatedAt: false },
  );

  console.log(`[recover-instagram] ✅ ${id}: ${oldUsername} → ${newNorm} (${source})`);
  return {
    recovered: true,
    clientId: id,
    oldUsername,
    newUsername: newNorm,
    reason: 'recovered',
    mergedLead,
    source,
  };
}

export type RecoverInstagramFromMessagesBatchParams = {
  offset?: number;
  limit?: number;
  clientId?: string;
  dryRun?: boolean;
};

export type RecoverInstagramFromMessagesBatchResult = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  stats?: Record<string, unknown>;
  samples?: Array<Record<string, unknown>>;
  errorDetails?: Array<Record<string, unknown>>;
  timestamp?: string;
};

export async function runRecoverInstagramFromMessagesBatch(
  params: RecoverInstagramFromMessagesBatchParams,
): Promise<RecoverInstagramFromMessagesBatchResult> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(200, params.limit ?? 80));
  const offset = Math.max(0, params.offset ?? 0);
  const dryRun = Boolean(params.dryRun);
  const clientId = (params.clientId || '').trim();

  try {
    const baseWhere: Prisma.DirectClientWhereInput = clientId
      ? { id: clientId }
      : RECOVER_IG_FROM_MESSAGES_WHERE;

    const allIds = await prisma.directClient.findMany({
      where: baseWhere,
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const totalTargets = allIds.length;
    const batchIds = allIds.slice(offset, offset + limit).map((r) => r.id);

    let processed = 0;
    let recovered = 0;
    let skippedNoHandle = 0;
    let skippedSame = 0;
    let skippedDuplicate = 0;
    let mergedLead = 0;
    let errors = 0;
    const samples: Array<Record<string, unknown>> = [];
    const errorDetails: Array<Record<string, unknown>> = [];

    for (const id of batchIds) {
      processed += 1;
      try {
        if (dryRun) {
          const handle = await getInstagramHandleFromClientMessages(id);
          const sibling = handle ? null : await findRealInstagramFromSiblingBySubscriber(id);
          const sid = !handle && !sibling ? await getSubscriberIdFromClientMessages(id) : null;
          samples.push({
            clientId: id,
            dryRun: true,
            fromRawData: handle,
            fromSibling: sibling?.handle || null,
            hasSubscriberId: Boolean(sid),
          });
          if (handle || sibling) recovered += 1;
          else skippedNoHandle += 1;
          continue;
        }

        const result = await recoverInstagramUsernameForClient(id);
        if (result.reason === 'already_normal') {
          skippedSame += 1;
        } else if (result.recovered) {
          recovered += 1;
          if (result.mergedLead) mergedLead += 1;
          if (samples.length < 30) {
            samples.push({
              clientId: result.clientId,
              oldUsername: result.oldUsername,
              newUsername: result.newUsername,
              source: result.source,
              mergedLead: result.mergedLead,
              action: 'recovered',
            });
          }
        } else if (result.reason === 'duplicate') {
          skippedDuplicate += 1;
          if (samples.length < 30) {
            samples.push({
              clientId: id,
              oldUsername: result.oldUsername,
              newUsername: result.newUsername,
              occupiedClientId: result.occupiedClientId,
              occupiedAltegioClientId: result.occupiedAltegioClientId,
              action: 'skipped_duplicate',
            });
          }
        } else {
          skippedNoHandle += 1;
          if (samples.length < 30) {
            samples.push({
              clientId: id,
              oldUsername: result.oldUsername,
              action: 'skipped_no_handle',
              reason: result.reason,
            });
          }
        }
      } catch (err) {
        errors += 1;
        errorDetails.push({
          clientId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const remaining = Math.max(0, totalTargets - offset - batchIds.length);

    return {
      ok: true,
      dryRun,
      stats: {
        totalTargets,
        processed,
        recovered,
        skippedNoHandle,
        skippedSame,
        skippedDuplicate,
        mergedLead,
        errors,
        offset,
        limit,
        remainingCount: remaining,
        nextBatchOffset: remaining > 0 ? offset + batchIds.length : null,
        ms: Date.now() - startedAt,
      },
      samples,
      errorDetails: errorDetails.slice(0, 20),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[recover-instagram] batch error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
