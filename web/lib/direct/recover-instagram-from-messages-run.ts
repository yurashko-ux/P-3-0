// web/lib/direct/recover-instagram-from-messages-run.ts
// Масове збереження реального Instagram з direct_messages.rawData у direct_clients.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { normalizeInstagram } from '@/lib/normalize';
import {
  getDirectClient,
  getDirectClientByInstagram,
  getInstagramHandleFromClientMessages,
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
  messages: { some: { rawData: { not: null } } },
};

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
      ? { id: clientId, ...RECOVER_IG_FROM_MESSAGES_WHERE }
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
      if (!row) {
        errors += 1;
        continue;
      }

      const clientName =
        [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.id;
      const oldUsername = row.instagramUsername;

      if (hasNormalInstagramUsername(oldUsername)) {
        skippedSame += 1;
        continue;
      }

      const recoveredHandle = await getInstagramHandleFromClientMessages(id);
      if (!recoveredHandle) {
        skippedNoHandle += 1;
        if (samples.length < 20) {
          samples.push({
            clientId: id,
            clientName,
            oldUsername,
            action: 'skipped_no_handle',
          });
        }
        continue;
      }

      const newNorm = normalizeInstagram(recoveredHandle) || recoveredHandle;
      const oldNorm = normalizeInstagram(oldUsername) || oldUsername;
      if (newNorm.toLowerCase() === oldNorm.toLowerCase()) {
        skippedSame += 1;
        continue;
      }

      const occupied = await getDirectClientByInstagram(newNorm);
      if (occupied && occupied.id !== id) {
        const currentHasAltegio = Number.isFinite(Number(row.altegioClientId));
        const occupiedHasAltegio = Number.isFinite(Number(occupied.altegioClientId));

        if (currentHasAltegio && !occupiedHasAltegio) {
          if (!dryRun) {
            try {
              const moved = await moveClientHistory(occupied.id!, id);
              await deleteDirectClient(occupied.id!);
              mergedLead += 1;
              console.log('[recover-instagram-from-messages] merged lead into altegio client', {
                keptId: id,
                removedLeadId: occupied.id,
                movedMessages: moved.movedMessages,
                newIg: newNorm,
              });
            } catch (mergeErr) {
              errors += 1;
              errorDetails.push({
                clientId: id,
                oldUsername,
                newUsername: newNorm,
                error: mergeErr instanceof Error ? mergeErr.message : String(mergeErr),
              });
              continue;
            }
          } else {
            mergedLead += 1;
          }
        } else {
          skippedDuplicate += 1;
          if (samples.length < 20) {
            samples.push({
              clientId: id,
              clientName,
              oldUsername,
              newUsername: newNorm,
              action: 'skipped_duplicate',
              otherClientId: occupied.id,
            });
          }
          continue;
        }
      }

      if (dryRun) {
        recovered += 1;
        if (samples.length < 20) {
          samples.push({
            clientId: id,
            clientName,
            oldUsername,
            newUsername: newNorm,
            action: 'would_recover',
          });
        }
        continue;
      }

      try {
        const directClient = await getDirectClient(id);
        if (!directClient) {
          errors += 1;
          continue;
        }
        await saveDirectClient(
          {
            ...directClient,
            instagramUsername: newNorm,
            updatedAt: new Date().toISOString(),
          },
          'recover-instagram-from-messages',
          { source: 'messages-rawData', oldUsername },
          { touchUpdatedAt: false },
        );
        recovered += 1;
        if (samples.length < 20) {
          samples.push({
            clientId: id,
            clientName,
            oldUsername,
            newUsername: newNorm,
            action: 'recovered',
          });
        }
        console.log(
          `[recover-instagram-from-messages] ✅ ${id} (${clientName}): ${oldUsername} → ${newNorm}`,
        );
      } catch (err) {
        errors += 1;
        errorDetails.push({
          clientId: id,
          oldUsername,
          newUsername: newNorm,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const remainingCount = Math.max(0, totalTargets - offset - batchIds.length);
    const nextBatchOffset = remainingCount > 0 ? offset + batchIds.length : null;
    const ms = Date.now() - startedAt;

    return {
      ok: true,
      dryRun,
      stats: {
        totalTargets,
        batchSize: batchIds.length,
        processed,
        recovered,
        skippedNoHandle,
        skippedSame,
        skippedDuplicate,
        mergedLead,
        errors,
        offset,
        nextBatchOffset,
        remainingCount,
        ms,
      },
      samples,
      errorDetails: errorDetails.slice(0, 30),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[recover-instagram-from-messages] run error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
  }
}
