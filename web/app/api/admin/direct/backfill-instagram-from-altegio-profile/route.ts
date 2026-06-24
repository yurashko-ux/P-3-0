// web/app/api/admin/direct/backfill-instagram-from-altegio-profile/route.ts
// Масове оновлення Instagram у Direct з профілю Altegio для карток з технічним username (altegio_*, missing_*, no_instagram_*)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saveDirectClient, prismaClientToDirectClient } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { extractInstagramFromAltegioClient, isTechnicalDirectInstagramUsername } from '@/lib/altegio/client-utils';
import { isDirectAdminAuthorized } from '@/lib/direct-admin-auth';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isDirectAdminAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    assertAltegioEnv();
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || Number.isNaN(companyId)) {
      return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID not configured' }, { status: 500 });
    }

    const delayMsRaw = req.nextUrl.searchParams.get('delayMs');
    const delayMs = Math.max(0, Math.min(2000, Number(delayMsRaw ?? '250') || 250));
    const limitRaw = req.nextUrl.searchParams.get('limit');
    /** 0 = без ліміту в одному запиті (ризик таймауту Vercel); краще батчами 100–300 */
    const limit = Math.max(0, Math.min(5000, Number(limitRaw ?? '200') || 200));
    const offsetRaw = req.nextUrl.searchParams.get('offset');
    const offset = Math.max(0, Number(offsetRaw ?? '0') || 0);
    const maxRunMsParam = parseInt(req.nextUrl.searchParams.get('maxRunMs') || '240000', 10);
    const maxRunMs = Number.isFinite(maxRunMsParam) ? Math.min(280000, Math.max(10000, maxRunMsParam)) : 240000;

    console.log('[direct/backfill-instagram-from-altegio-profile] Старт', {
      companyId,
      delayMs,
      limit,
      offset,
      maxRunMs,
    });

    const allWithAltegioId = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      orderBy: { id: 'asc' },
    });

    const allClients = allWithAltegioId;
    const targets = allClients
      .filter((c) => Boolean(c.altegioClientId) && isTechnicalDirectInstagramUsername(c.instagramUsername))
      .sort((a, b) => a.id.localeCompare(b.id));

    const totalTargets = targets.length;
    const batchTargets = limit > 0 ? targets.slice(offset, offset + limit) : targets.slice(offset);

    let processedInBatch = 0;
    let updated = 0;
    const skippedNotTechnical = allClients.length - totalTargets;
    let skippedNoIgInAltegio = 0;
    let skippedNoChange = 0;
    let fetchedNotFound = 0;
    let errors = 0;
    let stoppedEarly = false;
    const samples: Array<{ instagramUsername: string; altegioClientId: number; action: string; next?: string }> = [];
    const errorDetails: Array<{ instagramUsername: string; altegioClientId: number; error: string }> = [];

    for (let i = 0; i < batchTargets.length; i++) {
      if (Date.now() - startedAt >= maxRunMs) {
        stoppedEarly = true;
        console.log('[direct/backfill-instagram-from-altegio-profile] ⏹️ Зупинка по maxRunMs', {
          maxRunMs,
          processedInBatch,
        });
        break;
      }

      const client = batchTargets[i];
      if (!client.altegioClientId) continue;

      processedInBatch++;

      try {
        const altegioClient = await getClient(companyId, client.altegioClientId);
        if (!altegioClient) {
          fetchedNotFound++;
          continue;
        }

        const ig = extractInstagramFromAltegioClient(altegioClient);
        if (!ig) {
          skippedNoIgInAltegio++;
          continue;
        }

        if (ig === client.instagramUsername) {
          skippedNoChange++;
          continue;
        }

        const directClient = prismaClientToDirectClient(client);
        const updatedClient = {
          ...directClient,
          instagramUsername: ig,
          updatedAt: new Date().toISOString(),
        };

        await saveDirectClient(updatedClient, 'backfill-instagram-from-altegio-profile', {
          altegioClientId: client.altegioClientId,
          reason: 'технічний username → Instagram з профілю Altegio',
        }, { touchUpdatedAt: false });

        updated++;
        if (samples.length < 15) {
          samples.push({
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            action: 'saved',
            next: ig,
          });
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push({
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId!,
          error: msg,
        });
        console.error('[direct/backfill-instagram-from-altegio-profile] ❌', {
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
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

    console.log('[direct/backfill-instagram-from-altegio-profile] ✅ Готово', {
      totalClients: allClients.length,
      targetsWithTechnicalIg: totalTargets,
      batchOffset: offset,
      processedInBatch,
      updated,
      remainingCount,
      stoppedEarly,
      ms,
    });

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        targetsWithTechnicalIg: totalTargets,
        batchOffset: offset,
        batchSize: batchTargets.length,
        delayMs,
        limit: limit || null,
        offset,
        processed: processedInBatch,
        updated,
        skippedNotTechnical,
        skippedNoIgInAltegio,
        skippedNoChange,
        fetchedNotFound,
        errors,
        stoppedEarly,
        remainingCount,
        remainingApprox: remainingCount,
        nextBatchOffset: remainingCount > 0 ? nextBatchOffset : null,
        ms,
      },
      samples,
      errorDetails: errorDetails.slice(0, 20),
    });
  } catch (error) {
    console.error('[direct/backfill-instagram-from-altegio-profile]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
