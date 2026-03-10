// web/app/api/admin/direct/load-client-from-altegio/route.ts
// Тестове завантаження клієнта по Altegio ID: профіль, records в KV, sync-visit-history, backfill-visit-breakdown

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saveDirectClient } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { getEnvValue } from '@/lib/env';
import { normalizeInstagram } from '@/lib/normalize';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { kvWrite } from '@/lib/kv';
import type { DirectClient } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

function extractInstagramFromAltegioClient(client: any): string | null {
  const instagramFields: (string | null)[] = [
    client?.['instagram-user-name'],
    client?.instagram_user_name,
    client?.instagramUsername,
    client?.instagram_username,
    client?.instagram,
  ];

  if (Array.isArray(client?.custom_fields)) {
    for (const field of client.custom_fields) {
      if (field && typeof field === 'object') {
        const title = field.title || field.name || field.label || '';
        const value = field.value || field.data || field.content || field.text || '';
        if (value && typeof value === 'string' && /instagram/i.test(title)) {
          instagramFields.push(value);
        }
      }
    }
  }

  if (client?.custom_fields && typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
    instagramFields.push(
      client.custom_fields['instagram-user-name'],
      client.custom_fields.instagram_user_name,
      client.custom_fields.instagramUsername
    );
  }

  for (const field of instagramFields) {
    if (field && typeof field === 'string' && field.trim()) {
      const normalized = normalizeInstagram(field.trim());
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractNameFromAltegioClient(client: any): { firstName?: string; lastName?: string } {
  if (!client?.name) return {};
  const nameParts = String(client.name).trim().split(/\s+/);
  if (nameParts.length === 0) return {};
  if (nameParts.length === 1) return { firstName: nameParts[0] };
  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}

function getBaseUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  const port = process.env.PORT || 3000;
  return `http://127.0.0.1:${port}`;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * POST / load-client-from-altegio?altegioClientId=XXX
 * Тестово завантажує всі дані клієнта з Altegio в Direct таблицю.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId');
  const altegioId = altegioClientIdParam ? parseInt(altegioClientIdParam, 10) : null;
  if (!Number.isFinite(altegioId) || altegioId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Вкажіть altegioClientId (число) у query: ?altegioClientId=XXX' },
      { status: 400 }
    );
  }

  const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
  if (!companyIdStr) {
    return NextResponse.json(
      { ok: false, error: 'ALTEGIO_COMPANY_ID не налаштовано' },
      { status: 400 }
    );
  }
  const companyId = parseInt(companyIdStr, 10);
  if (isNaN(companyId)) {
    return NextResponse.json(
      { ok: false, error: 'Невірний ALTEGIO_COMPANY_ID' },
      { status: 400 }
    );
  }

  const stats = {
    created: false,
    updated: false,
    directClientId: null as string | null,
    recordsPushedToKV: 0,
    syncVisitHistory: null as { updated?: number; skipped?: number; errors?: number } | null,
    backfillBreakdown: null as { updated?: number; reason?: string } | null,
  };

  try {
    // 1. Профіль з Altegio (getClient пробує різні endpoint'и: /clients/{location_id}?id=, /company/.../clients/search тощо)
    const clientData = await getClient(companyId, altegioId);
    if (!clientData) {
      return NextResponse.json({
        ok: false,
        error: `Клієнт з Altegio ID ${altegioId} не знайдено (спробовано різні endpoint'и API)`,
      }, { status: 404 });
    }

    // 2. Records в KV
    const rawRecords = await getClientRecordsRaw(companyId, altegioId);
    for (const rec of rawRecords) {
      if (rec?.deleted) continue;
      const event = rawRecordToRecordEvent(rec, altegioId, companyId);
      if (event.clientId) {
        await kvWrite.lpush('altegio:records:log', JSON.stringify(event));
        stats.recordsPushedToKV++;
      }
    }
    await kvWrite.ltrim('altegio:records:log', 0, 9999);

    // 3. Перевірка існування в Direct
    const existing = await prisma.directClient.findFirst({
      where: { altegioClientId: altegioId },
    });

    let instagramUsername = extractInstagramFromAltegioClient(clientData);
    if (!instagramUsername) {
      const { firstName, lastName } = extractNameFromAltegioClient(clientData);
      const nameSlug = (firstName || lastName || 'client')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 10);
      instagramUsername = `altegio_${nameSlug}_${altegioId}`;
    }
    instagramUsername = normalizeInstagram(instagramUsername) || instagramUsername;

    const { firstName, lastName } = extractNameFromAltegioClient(clientData);
    const phone = (clientData?.phone ?? '').toString().trim();
    const visits = Number(clientData?.visits) || null;
    const spent = Number(clientData?.spent) || null;
    const lastRecord = rawRecords.filter((r) => !r?.deleted)[0];
    let lastVisitAt: string | undefined;
    const lv = clientData?.last_visit_date ?? lastRecord?.date ?? lastRecord?.datetime;
    if (lv) {
      const d = new Date(lv);
      if (!isNaN(d.getTime())) lastVisitAt = d.toISOString();
    }

    const servicesForState = lastRecord?.services ?? lastRecord?.data?.services ?? [];
    const stateFromServices = determineStateFromServices(Array.isArray(servicesForState) ? servicesForState : []);
    const determinedState = (stateFromServices ?? 'client') as 'consultation' | 'hair-extension' | 'other-services' | 'client';

    let serviceMasterName: string | undefined;
    const staff = lastRecord?.staff ?? lastRecord?.data?.staff;
    if (staff?.name) serviceMasterName = String(staff.name);

    const now = new Date().toISOString();

    if (!existing) {
      // Створити нового клієнта
      const newClient: Partial<DirectClient> = {
        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        instagramUsername,
        firstName,
        lastName,
        ...(phone ? { phone } : {}),
        source: 'instagram',
        state: determinedState,
        firstContactDate: now,
        statusId: 'new',
        visitedSalon: false,
        signedUpForPaidService: false,
        altegioClientId: altegioId,
        createdAt: now,
        updatedAt: now,
        ...(visits != null ? { visits } : {}),
        ...(spent != null ? { spent } : {}),
        ...(lastVisitAt ? { lastVisitAt } : {}),
        ...(serviceMasterName ? { serviceMasterName } : {}),
      };
      await saveDirectClient(
        newClient as DirectClient,
        'load-client-from-altegio',
        { altegioClientId: altegioId },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );
      stats.created = true;
      stats.directClientId = newClient.id!;
    } else {
      // Оновити профіль існуючого
      const updated = {
        ...existing,
        visits: visits ?? existing.visits,
        spent: spent ?? existing.spent,
        lastVisitAt: lastVisitAt ? new Date(lastVisitAt) : existing.lastVisitAt,
        phone: phone || existing.phone,
        updatedAt: new Date(now),
      };
      await saveDirectClient(
        updated as unknown as DirectClient,
        'load-client-from-altegio',
        { altegioClientId: altegioId },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );
      stats.updated = true;
      stats.directClientId = existing.id;
    }

    // 4. Sync visit history
    const baseUrl = getBaseUrl();
    const authParam = CRON_SECRET ? `&secret=${encodeURIComponent(CRON_SECRET)}` : '';
    try {
      const syncRes = await fetch(
        `${baseUrl}/api/admin/direct/sync-visit-history-from-api?altegioClientId=${altegioId}&delayMs=150${authParam}`,
        { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
      );
      const syncData = await syncRes.json();
      if (syncData?.stats) {
        stats.syncVisitHistory = {
          updated: syncData.stats.updated ?? 0,
          skipped: syncData.stats.skipped ?? 0,
          errors: syncData.stats.errors ?? 0,
        };
      }
    } catch (syncErr) {
      console.warn('[load-client-from-altegio] sync-visit-history failed:', syncErr);
      stats.syncVisitHistory = { errors: 1 };
    }

    // 5. Backfill visit breakdown (якщо є paidServiceDate)
    try {
      const breakdownRes = await fetch(
        `${baseUrl}/api/admin/direct/backfill-visit-breakdown?altegioClientId=${altegioId}${authParam}`,
        { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
      );
      const breakdownData = await breakdownRes.json();
      if (breakdownData?.reason) {
        stats.backfillBreakdown = { reason: breakdownData.reason };
      }
      if (breakdownData?.updated != null) {
        stats.backfillBreakdown = { ...stats.backfillBreakdown, updated: breakdownData.updated };
      }
    } catch (breakdownErr) {
      console.warn('[load-client-from-altegio] backfill-visit-breakdown failed:', breakdownErr);
    }

    const client = await prisma.directClient.findFirst({
      where: { altegioClientId: altegioId },
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        consultationBookingDate: true,
        consultationAttended: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        paidServiceTotalCost: true,
        visits: true,
        spent: true,
      },
    });

    return NextResponse.json({
      ok: true,
      stats,
      client: client ? {
        ...client,
        consultationBookingDate: client.consultationBookingDate?.toISOString?.() ?? null,
        paidServiceDate: client.paidServiceDate?.toISOString?.() ?? null,
      } : null,
      message: stats.created
        ? `Клієнт створено. Записів у KV: ${stats.recordsPushedToKV}. Sync: ${stats.syncVisitHistory?.updated ?? 0} оновлено.`
        : `Клієнт оновлено. Записів у KV: ${stats.recordsPushedToKV}. Sync: ${stats.syncVisitHistory?.updated ?? 0} оновлено.`,
    });
  } catch (error) {
    console.error('[load-client-from-altegio] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
