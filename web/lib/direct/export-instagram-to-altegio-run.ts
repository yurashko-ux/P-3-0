// web/lib/direct/export-instagram-to-altegio-run.ts
// Логіка експорту Instagram з Direct в Altegio (викликається з API route і Server Action).

import { prisma } from '@/lib/prisma';
import { getClient, updateAltegioClient, resolveNamePhoneForAltegioUpdate } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { normalizeInstagram } from '@/lib/normalize';

const ALTEGIO_INSTAGRAM_CUSTOM_FIELD_KEY = 'instagram-user-name';

export type ExportInstagramBatchParams = {
  offset: number;
  limit: number;
  delayMs: number;
  maxRunMs?: number;
};

export type ExportInstagramBatchResult = {
  ok: boolean;
  error?: string;
  stats?: Record<string, unknown>;
  samples?: Array<Record<string, unknown>>;
  errorDetails?: Array<Record<string, unknown>>;
  timestamp?: string;
};

export async function runExportInstagramToAltegioBatch(
  params: ExportInstagramBatchParams,
): Promise<ExportInstagramBatchResult> {
  const startedAt = Date.now();
  const delayMs = Math.max(0, Math.min(2000, params.delayMs || 250));
  const limit = Math.max(0, Math.min(5000, params.limit || 40));
  const offset = Math.max(0, params.offset || 0);
  const maxRunMs = params.maxRunMs ?? 240000;

  try {
    assertAltegioEnv();
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || Number.isNaN(companyId)) {
      return { ok: false, error: 'ALTEGIO_COMPANY_ID not configured' };
    }

    console.log('[direct/export-instagram-to-altegio] Старт експорту Instagram в Altegio', {
      companyId,
      delayMs,
      limit,
      offset,
      maxRunMs,
      via: 'runExportInstagramToAltegioBatch',
    });

    const allWithAltegioId = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });

    const targets = allWithAltegioId
      .filter((c) => hasNormalInstagramUsername(c.instagramUsername))
      .sort((a, b) => a.id.localeCompare(b.id));

    const totalTargets = targets.length;
    const batchTargets = limit > 0 ? targets.slice(offset, offset + limit) : targets.slice(offset);

    let processedInBatch = 0;
    let updated = 0;
    let skippedNoAltegioId = 0;
    const skippedNoNormalIg = allWithAltegioId.length - totalTargets;
    let skippedNoPhone = 0;
    let skippedNoIgNormalized = 0;
    let fetchedNotFound = 0;
    let errors = 0;
    let stoppedEarly = false;
    const samples: Array<{
      instagramUsername: string;
      altegioClientId: number;
      action: string;
      exported?: string;
    }> = [];
    const errorDetails: Array<{ instagramUsername: string; altegioClientId: number; error: string }> = [];

    for (let i = 0; i < batchTargets.length; i++) {
      if (Date.now() - startedAt >= maxRunMs) {
        stoppedEarly = true;
        console.log('[direct/export-instagram-to-altegio] ⏹️ Зупинка по maxRunMs', {
          maxRunMs,
          processedInBatch,
        });
        break;
      }

      const client = batchTargets[i];
      const altegioClientId = client.altegioClientId;
      if (!altegioClientId) {
        skippedNoAltegioId++;
        processedInBatch++;
        continue;
      }

      processedInBatch++;

      try {
        const normalizedIg = normalizeInstagram(client.instagramUsername);
        if (!normalizedIg) {
          skippedNoIgNormalized++;
          continue;
        }

        const altegioClient = await getClient(companyId, altegioClientId);
        if (!altegioClient) {
          fetchedNotFound++;
          continue;
        }

        const { name, phone } = resolveNamePhoneForAltegioUpdate(client, altegioClient);
        if (!phone) {
          skippedNoPhone++;
          continue;
        }

        await updateAltegioClient(companyId, altegioClientId, {
          name,
          phone,
          custom_fields: {
            [ALTEGIO_INSTAGRAM_CUSTOM_FIELD_KEY]: normalizedIg,
          },
        });

        updated++;
        if (samples.length < 10) {
          samples.push({
            instagramUsername: client.instagramUsername,
            altegioClientId,
            action: 'exported',
            exported: normalizedIg,
          });
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push({
          instagramUsername: client.instagramUsername,
          altegioClientId,
          error: msg,
        });
        console.error('[direct/export-instagram-to-altegio] ❌ Помилка експорту', {
          instagramUsername: client.instagramUsername,
          altegioClientId,
          error: msg,
        });
      } finally {
        if (delayMs && i < batchTargets.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const nextBatchOffset = offset + processedInBatch;
    const remainingCount = Math.max(0, totalTargets - nextBatchOffset);
    const ms = Date.now() - startedAt;

    console.log('[direct/export-instagram-to-altegio] ✅ Готово', {
      totalWithAltegioId: allWithAltegioId.length,
      totalTargets,
      processedInBatch,
      updated,
      remainingCount,
      stoppedEarly,
      ms,
    });

    return {
      ok: true,
      stats: {
        totalWithAltegioId: allWithAltegioId.length,
        targets: totalTargets,
        batchOffset: offset,
        batchSize: batchTargets.length,
        delayMs,
        limit,
        offset,
        processed: processedInBatch,
        updated,
        skippedNoAltegioId,
        skippedNoNormalIg,
        skippedNoPhone,
        skippedNoIgNormalized,
        fetchedNotFound,
        errors,
        stoppedEarly,
        remainingCount,
        nextBatchOffset: remainingCount > 0 ? nextBatchOffset : null,
        ms,
      },
      samples,
      errorDetails: errorDetails.slice(0, 30),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[direct/export-instagram-to-altegio] run error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
