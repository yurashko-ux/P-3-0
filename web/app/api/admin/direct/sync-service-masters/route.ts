// web/app/api/admin/direct/sync-service-masters/route.ts
// Масово заповнює колонку "Майстер" (serviceMasterName/serviceMasterAltegioStaffId) на основі згрупованих Altegio records.
// Пише історію змін (serviceMasterHistory). Логіка виключає адмінів/невідомих майстрів.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickNonAdminStaffFromGroup,
  appendServiceMasterHistory,
} from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function toBool(v: string | null): boolean {
  if (!v) return false;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const force = toBool(req.nextUrl.searchParams.get('force')); // якщо true — перерахувати навіть якщо вже заповнено
    const onlyMissing = !toBool(req.nextUrl.searchParams.get('all')); // дефолт: оновлюємо тільки порожні
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.max(1, Math.min(5000, parseInt(limitParam, 10) || 0)) : 0;

    console.log('[direct/sync-service-masters] 🚀 Start', { force, onlyMissing, limit: limit || 'all' });

    const clients = await prisma.directClient.findMany({
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        serviceMasterName: true,
        serviceMasterAltegioStaffId: true,
        serviceMasterHistory: true,
      },
      orderBy: { updatedAt: 'desc' },
      ...(limit ? { take: limit } : {}),
    });

    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    let checked = 0;
    let updated = 0;
    let skippedNoAltegioId = 0;
    let skippedOnlyMissing = 0;
    let skippedNoGroups = 0;
    let skippedNoStaff = 0;
    let skippedNoChange = 0;
    let errors = 0;

    const details: Array<{ instagramUsername: string; altegioClientId?: number; status: string; from?: string; to?: string }> = [];

    for (const c of clients) {
      if (!c.altegioClientId) {
        skippedNoAltegioId++;
        continue;
      }
      if (onlyMissing && !force && (c.serviceMasterName || '').trim()) {
        skippedOnlyMissing++;
        continue;
      }

      checked++;

      const groups = groupsByClient.get(c.altegioClientId) || [];
      if (!groups.length) {
        skippedNoGroups++;
        continue;
      }

      // Найновіші групи вже відсортовані в records-grouping (desc).
      const chosen = groups.find((g: any) => g.groupType === 'paid') || groups.find((g: any) => g.groupType === 'consultation') || null;
      if (!chosen) {
        skippedNoGroups++;
        continue;
      }

      const picked = pickNonAdminStaffFromGroup(chosen, 'latest');
      if (!picked?.staffName) {
        skippedNoStaff++;
        continue;
      }

      const from = (c.serviceMasterName || '').trim();
      const to = picked.staffName.trim();
      if (!force && from === to && (c.serviceMasterAltegioStaffId ?? null) === (picked.staffId ?? null)) {
        skippedNoChange++;
        continue;
      }

      try {
        const nextHistory = appendServiceMasterHistory(c.serviceMasterHistory, {
          kyivDay: chosen.kyivDay,
          masterName: to,
          source: 'admin-sync',
        });

        await prisma.directClient.update({
          where: { id: c.id },
          data: {
            serviceMasterName: to,
            serviceMasterAltegioStaffId: picked.staffId ?? null,
            serviceMasterHistory: nextHistory,
          },
        });

        updated++;
        details.push({ instagramUsername: c.instagramUsername, altegioClientId: c.altegioClientId, status: 'updated', from, to });
      } catch (e) {
        errors++;
        console.error('[direct/sync-service-masters] ❌ update failed', {
          id: c.id,
          instagramUsername: c.instagramUsername,
          altegioClientId: c.altegioClientId,
          error: e instanceof Error ? e.message : String(e),
        });
        details.push({ instagramUsername: c.instagramUsername, altegioClientId: c.altegioClientId, status: 'error' });
      }
    }

    console.log('[direct/sync-service-masters] ✅ Done', { totalClients: clients.length, checked, updated, errors });

    return NextResponse.json({
      ok: true,
      results: {
        totalClients: clients.length,
        checked,
        updated,
        skippedNoAltegioId,
        skippedOnlyMissing,
        skippedNoGroups,
        skippedNoStaff,
        skippedNoChange,
        errors,
        details: details.slice(0, 50),
      },
      debug: {
        normalizedEventsCount: normalizedEvents.length,
        groupsByClientCount: groupsByClient.size,
      },
    });
  } catch (error) {
    console.error('[direct/sync-service-masters] ❌ Error:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

