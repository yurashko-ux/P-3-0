// web/app/api/admin/direct/backfill-altegio-phones/route.ts
// Backfill телефонів з Altegio в DirectClient.phone (по altegioClientId)

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function maskPhone(phone: string): string {
  const t = phone.trim();
  if (t.length <= 4) return '***';
  return `${t.slice(0, 2)}***${t.slice(-2)}`;
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

    const onlyMissing = req.nextUrl.searchParams.get('onlyMissing') !== '0';
    const force = req.nextUrl.searchParams.get('force') === '1';
    const delayMsRaw = req.nextUrl.searchParams.get('delayMs');
    const delayMs = Math.max(0, Math.min(2000, Number(delayMsRaw ?? '250') || 250));
    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = Math.max(0, Math.min(5000, Number(limitRaw ?? '0') || 0));

    console.log('[direct/backfill-altegio-phones] Старт backfill телефонів з Altegio', {
      companyId,
      onlyMissing,
      force,
      delayMs,
      limit,
    });

    const allClients = await getAllDirectClients();
    const targets = allClients.filter((c) => Boolean(c.altegioClientId));

    let processed = 0;
    let updated = 0;
    let skippedNoAltegioId = allClients.length - targets.length;
    let skippedExists = 0;
    let skippedNoPhone = 0;
    let skippedNoChange = 0;
    let fetchedNotFound = 0;
    let errors = 0;
    const samples: Array<{ instagramUsername: string; altegioClientId: number; action: string }> = [];
    const errorDetails: Array<{ instagramUsername: string; altegioClientId: number; error: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const client = targets[i];
      if (!client.altegioClientId) continue;

      if (limit && processed >= limit) break;
      processed++;

      try {
        if (onlyMissing && client.phone && client.phone.trim() && !force) {
          skippedExists++;
          continue;
        }

        const altegioClient = await getClient(companyId, client.altegioClientId);
        if (!altegioClient) {
          fetchedNotFound++;
          continue;
        }

        const phone = (altegioClient.phone || '').toString().trim();
        if (!phone) {
          skippedNoPhone++;
          continue;
        }

        if (!force && client.phone && client.phone.trim() === phone) {
          skippedNoChange++;
          continue;
        }

        const updatedClient = {
          ...client,
          phone,
          updatedAt: new Date().toISOString(),
        };

        await saveDirectClient(updatedClient, 'backfill-altegio-phones', {
          altegioClientId: client.altegioClientId,
          phoneMasked: maskPhone(phone),
          reason: force ? 'force=1' : onlyMissing ? 'onlyMissing=1' : 'overwrite',
        }, { touchUpdatedAt: false });

        updated++;
        if (samples.length < 10) {
          samples.push({
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            action: 'saved',
          });
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push({
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          error: msg,
        });
        console.error('[direct/backfill-altegio-phones] ❌ Помилка backfill', {
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          error: msg,
        });
      } finally {
        if (delayMs && i < targets.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const ms = Date.now() - startedAt;
    console.log('[direct/backfill-altegio-phones] ✅ Готово', {
      totalClients: allClients.length,
      targets: targets.length,
      processed,
      updated,
      skippedNoAltegioId,
      skippedExists,
      skippedNoPhone,
      skippedNoChange,
      fetchedNotFound,
      errors,
      ms,
    });

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        targets: targets.length,
        onlyMissing,
        force,
        delayMs,
        limit,
        processed,
        updated,
        skippedNoAltegioId,
        skippedExists,
        skippedNoPhone,
        skippedNoChange,
        fetchedNotFound,
        errors,
        ms,
      },
      samples,
      errorDetails: errorDetails.slice(0, 30),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[direct/backfill-altegio-phones] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

