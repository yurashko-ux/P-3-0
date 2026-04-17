// web/app/api/admin/direct/backfill-instagram-from-altegio-profile/route.ts
// Масове оновлення Instagram у Direct з профілю Altegio для карток з технічним username (altegio_*, missing_*, no_instagram_*)

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { extractInstagramFromAltegioClient, isTechnicalDirectInstagramUsername } from '@/lib/altegio/client-utils';
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

    console.log('[direct/backfill-instagram-from-altegio-profile] Старт', { companyId, delayMs, limit });

    const allClients = await getAllDirectClients();
    const targets = allClients.filter(
      (c) => Boolean(c.altegioClientId) && isTechnicalDirectInstagramUsername(c.instagramUsername)
    );

    let processed = 0;
    let updated = 0;
    let skippedNotTechnical = allClients.length - targets.length;
    let skippedNoIgInAltegio = 0;
    let skippedNoChange = 0;
    let fetchedNotFound = 0;
    let errors = 0;
    const samples: Array<{ instagramUsername: string; altegioClientId: number; action: string; next?: string }> = [];
    const errorDetails: Array<{ instagramUsername: string; altegioClientId: number; error: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const client = targets[i];
      if (!client.altegioClientId) continue;

      if (limit > 0 && processed >= limit) break;
      processed++;

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

        const updatedClient = {
          ...client,
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
        if (delayMs && i < targets.length - 1 && (!limit || processed < limit)) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const ms = Date.now() - startedAt;
    const remaining =
      limit > 0 && targets.length > processed ? Math.max(0, targets.length - processed) : 0;

    console.log('[direct/backfill-instagram-from-altegio-profile] ✅ Готово', {
      totalClients: allClients.length,
      targetsWithTechnicalIg: targets.length,
      processed,
      updated,
      ms,
    });

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        targetsWithTechnicalIg: targets.length,
        delayMs,
        limit: limit || null,
        processed,
        updated,
        skippedNotTechnical,
        skippedNoIgInAltegio,
        skippedNoChange,
        fetchedNotFound,
        errors,
        remainingApprox: remaining,
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
