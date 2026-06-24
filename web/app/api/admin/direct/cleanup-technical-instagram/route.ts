// web/app/api/admin/direct/cleanup-technical-instagram/route.ts
// Заміна технічних instagramUsername (altegio_*, missing_*, …) на реальні або внутрішній __no_ig__ placeholder.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';
import {
  buildNoInstagramPlaceholderUsername,
  extractInstagramFromAltegioClient,
  hasNormalInstagramUsername,
} from '@/lib/altegio/client-utils';
import { phonesMatch } from '@/lib/binotel/normalize-phone';
import {
  deleteDirectClient,
  prismaClientToDirectClient,
  saveDirectClient,
} from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import type { Prisma } from '@prisma/client';

export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

/** Технічні ніки, які ще треба очистити (без уже готового __no_ig__). */
const TECHNICAL_INSTAGRAM_WHERE: Prisma.DirectClientWhereInput = {
  OR: [
    { instagramUsername: { startsWith: 'altegio_' } },
    { instagramUsername: { startsWith: 'missing_instagram_' } },
    { instagramUsername: { startsWith: 'no_instagram_' } },
  ],
};

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Лід з реальним IG без Altegio ID, збіг телефону. */
async function findLeadForPhoneMerge(
  technicalId: string,
  phone: string | null | undefined,
): Promise<ReturnType<typeof prismaClientToDirectClient> | null> {
  const p = (phone || '').trim();
  if (!p) return null;

  const exact = await prisma.directClient.findFirst({
    where: {
      id: { not: technicalId },
      altegioClientId: null,
      phone: p,
    },
  });
  if (exact && hasNormalInstagramUsername(exact.instagramUsername)) {
    return prismaClientToDirectClient(exact);
  }

  const candidates = await prisma.directClient.findMany({
    where: {
      id: { not: technicalId },
      altegioClientId: null,
      phone: { not: null },
      AND: [
        { instagramUsername: { not: { startsWith: 'altegio_' } } },
        { instagramUsername: { not: { startsWith: 'missing_instagram_' } } },
        { instagramUsername: { not: { startsWith: 'no_instagram_' } } },
        { instagramUsername: { not: { startsWith: '__no_ig__' } } },
        { instagramUsername: { not: 'NO INSTAGRAM' } },
        { instagramUsername: { not: { startsWith: 'binotel_' } } },
      ],
    },
    take: 30,
    orderBy: { updatedAt: 'desc' },
  });

  const matched = candidates.find(
    (c) => hasNormalInstagramUsername(c.instagramUsername) && phonesMatch(c.phone, p),
  );
  return matched ? prismaClientToDirectClient(matched) : null;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    assertAltegioEnv();
    const companyId = parseInt(process.env.ALTEGIO_COMPANY_ID || '', 10);
    if (!companyId || Number.isNaN(companyId)) {
      return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID not configured' }, { status: 500 });
    }

    const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') ?? '150') || 150));
    const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') ?? '40') || 40));
    // offset ігноруємо: після обробки рядки виходять із фільтра, завжди беремо «перші N» технічних.
    const maxRunMsParam = parseInt(req.nextUrl.searchParams.get('maxRunMs') || '120000', 10);
    const maxRunMs = Number.isFinite(maxRunMsParam) ? Math.min(280000, Math.max(10000, maxRunMsParam)) : 120000;
    const skipAltegio = req.nextUrl.searchParams.get('skipAltegio') === '1';

    const totalClients = await prisma.directClient.count();
    const countRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM "direct_clients"
      WHERE "instagramUsername" LIKE 'altegio_%'
        OR "instagramUsername" LIKE 'missing_instagram_%'
        OR "instagramUsername" LIKE 'no_instagram_%'
    `;
    const totalTargets = Number(countRows[0]?.cnt ?? 0);

    const batchIds = await prisma.directClient.findMany({
      where: TECHNICAL_INSTAGRAM_WHERE,
      orderBy: { id: 'asc' },
      take: limit > 0 ? limit : totalTargets,
      select: { id: true },
    });

    let processedInBatch = 0;
    let updatedFromAltegio = 0;
    let mergedWithLead = 0;
    let setPlaceholder = 0;
    let skippedNoAltegioId = 0;
    let fetchedNotFound = 0;
    let errors = 0;
    let stoppedEarly = false;
    const samples: Array<{ from: string; to: string; action: string; altegioClientId?: number | null }> = [];
    const errorDetails: Array<{ id: string; instagramUsername: string; error: string }> = [];

    for (let i = 0; i < batchIds.length; i++) {
      if (Date.now() - startedAt >= maxRunMs) {
        stoppedEarly = true;
        break;
      }

      const dbRow = await prisma.directClient.findUnique({ where: { id: batchIds[i].id } });
      if (!dbRow) continue;

      const row = dbRow;
      processedInBatch++;

      try {
        const direct = prismaClientToDirectClient(row);

        if (!skipAltegio && row.altegioClientId) {
          const altegioClient = await getClient(companyId, row.altegioClientId);
          if (!altegioClient) {
            fetchedNotFound++;
          } else {
            const ig = extractInstagramFromAltegioClient(altegioClient);
            if (ig && ig !== row.instagramUsername) {
              await saveDirectClient(
                { ...direct, instagramUsername: ig, updatedAt: new Date().toISOString() },
                'cleanup-technical-instagram-altegio',
                { altegioClientId: row.altegioClientId },
                { touchUpdatedAt: false },
              );
              updatedFromAltegio++;
              if (samples.length < 15) {
                samples.push({
                  from: row.instagramUsername,
                  to: ig,
                  action: 'from_altegio',
                  altegioClientId: row.altegioClientId,
                });
              }
              continue;
            }
          }
        } else if (!skipAltegio) {
          skippedNoAltegioId++;
        }

        const lead = await findLeadForPhoneMerge(row.id, row.phone);
        if (lead && row.altegioClientId) {
          await saveDirectClient(
            {
              ...lead,
              altegioClientId: row.altegioClientId,
              phone: lead.phone || row.phone,
              firstName: lead.firstName || row.firstName,
              lastName: lead.lastName || row.lastName,
              state: (lead.state || row.state || 'client') as DirectClient['state'],
              updatedAt: new Date().toISOString(),
            },
            'cleanup-technical-instagram-merge-lead',
            { mergedFromTechnicalId: row.id, altegioClientId: row.altegioClientId },
            { touchUpdatedAt: false },
          );
          await deleteDirectClient(row.id);
          mergedWithLead++;
          if (samples.length < 15) {
            samples.push({
              from: row.instagramUsername,
              to: lead.instagramUsername,
              action: 'merged_lead',
              altegioClientId: row.altegioClientId,
            });
          }
          continue;
        }

        const placeholder = buildNoInstagramPlaceholderUsername(row.id);
        if (row.instagramUsername !== placeholder) {
          await saveDirectClient(
            { ...direct, instagramUsername: placeholder, updatedAt: new Date().toISOString() },
            'cleanup-technical-instagram-placeholder',
            { previous: row.instagramUsername },
            { touchUpdatedAt: false },
          );
          setPlaceholder++;
          if (samples.length < 15) {
            samples.push({
              from: row.instagramUsername,
              to: placeholder,
              action: 'placeholder',
              altegioClientId: row.altegioClientId,
            });
          }
        }
      } catch (err) {
        errors++;
        errorDetails.push({
          id: row.id,
          instagramUsername: row.instagramUsername,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (delayMs && i < batchIds.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const remainingRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM "direct_clients"
      WHERE "instagramUsername" LIKE 'altegio_%'
        OR "instagramUsername" LIKE 'missing_instagram_%'
        OR "instagramUsername" LIKE 'no_instagram_%'
    `;
    const remainingCount = Number(remainingRows[0]?.cnt ?? 0);
    const ms = Date.now() - startedAt;

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients,
        targetsTechnical: totalTargets,
        batchSize: batchIds.length,
        processed: processedInBatch,
        updatedFromAltegio,
        mergedWithLead,
        setPlaceholder,
        skippedNoAltegioId,
        fetchedNotFound,
        errors,
        skipAltegio,
        stoppedEarly,
        remainingCount,
        nextBatchOffset: remainingCount > 0 ? 0 : null,
        ms,
      },
      samples,
      errorDetails: errorDetails.slice(0, 20),
    });
  } catch (error) {
    console.error('[direct/cleanup-technical-instagram]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
