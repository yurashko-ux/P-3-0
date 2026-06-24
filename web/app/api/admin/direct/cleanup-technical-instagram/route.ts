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
  isTechnicalDirectInstagramUsername,
} from '@/lib/altegio/client-utils';
import { normalizeInstagram } from '@/lib/normalize';
import { phonesMatch } from '@/lib/binotel/normalize-phone';
import {
  deleteDirectClient,
  prismaClientToDirectClient,
  saveDirectClient,
} from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

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
    const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') ?? '200') || 200));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset') ?? '0') || 0);
    const maxRunMsParam = parseInt(req.nextUrl.searchParams.get('maxRunMs') || '240000', 10);
    const maxRunMs = Number.isFinite(maxRunMsParam) ? Math.min(280000, Math.max(10000, maxRunMsParam)) : 240000;

    const allClients = await prisma.directClient.findMany({ orderBy: { id: 'asc' } });
    const targets = allClients
      .filter((c) => isTechnicalDirectInstagramUsername(c.instagramUsername))
      .sort((a, b) => a.id.localeCompare(b.id));

    const totalTargets = targets.length;
    const batchTargets = limit > 0 ? targets.slice(offset, offset + limit) : targets.slice(offset);

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

    for (let i = 0; i < batchTargets.length; i++) {
      if (Date.now() - startedAt >= maxRunMs) {
        stoppedEarly = true;
        break;
      }

      const row = batchTargets[i];
      processedInBatch++;

      try {
        const direct = prismaClientToDirectClient(row);

        // 1. Altegio API
        if (row.altegioClientId) {
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
        } else {
          skippedNoAltegioId++;
        }

        // 2. Злиття з лідом з реальним IG (телефон)
        if (row.phone?.trim()) {
          const lead = allClients.find(
            (c) =>
              c.id !== row.id &&
              hasNormalInstagramUsername(c.instagramUsername) &&
              !c.altegioClientId &&
              phonesMatch(c.phone, row.phone),
          );
          if (lead && row.altegioClientId) {
            const leadDirect = prismaClientToDirectClient(lead);
            await saveDirectClient(
              {
                ...leadDirect,
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
        }

        // 3. Внутрішній placeholder (не altegio_*)
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
        if (delayMs && i < batchTargets.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const nextBatchOffset = offset + processedInBatch;
    const remainingCount = Math.max(0, totalTargets - nextBatchOffset);
    const ms = Date.now() - startedAt;

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        targetsTechnical: totalTargets,
        batchOffset: offset,
        batchSize: batchTargets.length,
        processed: processedInBatch,
        updatedFromAltegio,
        mergedWithLead,
        setPlaceholder,
        skippedNoAltegioId,
        fetchedNotFound,
        errors,
        stoppedEarly,
        remainingCount,
        nextBatchOffset: remainingCount > 0 ? nextBatchOffset : null,
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
