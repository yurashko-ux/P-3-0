// web/app/api/admin/direct/debug-altegio-records/route.ts
// Діагностика відповіді Altegio API для records — перевірка формату даних та альтернативних endpoint'ів

import { NextRequest, NextResponse } from 'next/server';
import { altegioFetch } from '@/lib/altegio/client';
import { getClientRecordsRaw, getRawRecordsArrayFromResponse } from '@/lib/altegio/records';
import { getEnvValue } from '@/lib/env';

export const dynamic = 'force-dynamic';

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

/**
 * GET — діагностика records API для одного клієнта.
 * Query: altegioClientId=XXX
 * Повертає сиру відповідь з основних та альтернативних endpoint'ів.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId');
  const altegioClientId = altegioClientIdParam ? parseInt(altegioClientIdParam, 10) : null;
  if (!Number.isFinite(altegioClientId) || altegioClientId <= 0) {
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

  const results: Record<string, unknown> = {
    altegioClientId,
    companyId,
    endpoints: {} as Record<string, unknown>,
  };

  // 1. Основний: records/{locationId}?client_id=
  try {
    const mainRecords = await getClientRecordsRaw(companyId, altegioClientId);
    (results.endpoints as Record<string, unknown>)['records_locationId'] = {
      path: `records/${companyId}?client_id=${altegioClientId}`,
      recordsCount: mainRecords.length,
      records: mainRecords.slice(0, 3).map((r) => ({
        date: r?.date ?? r?.datetime,
        visit_id: r?.visit_id ?? r?.visitId,
        services: r?.services ?? r?.data?.services,
        attendance: r?.attendance ?? r?.visit_attendance,
      })),
    };
  } catch (err) {
    (results.endpoints as Record<string, unknown>)['records_locationId'] = {
      path: `records/${companyId}?client_id=${altegioClientId}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Альтернатива: company/{companyId}/records?client_id=
  try {
    const path = `company/${companyId}/records?client_id=${altegioClientId}`;
    const response = await altegioFetch<any>(path, { method: 'GET' });
    const list = getRawRecordsArrayFromResponse(response);
    (results.endpoints as Record<string, unknown>)['company_records'] = {
      path,
      rawKeys: response && typeof response === 'object' ? Object.keys(response) : [],
      recordsCount: list.length,
      records: list.slice(0, 3).map((r: any) => ({
        date: r?.date ?? r?.datetime,
        visit_id: r?.visit_id ?? r?.visitId,
        services: r?.services ?? r?.data?.services,
        attendance: r?.attendance ?? r?.visit_attendance,
      })),
    };
  } catch (err) {
    (results.endpoints as Record<string, unknown>)['company_records'] = {
      path: `company/${companyId}/records?client_id=${altegioClientId}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Альтернатива: records?company_id=&client_id=
  try {
    const path = `records?company_id=${companyId}&client_id=${altegioClientId}`;
    const response = await altegioFetch<any>(path, { method: 'GET' });
    const list = getRawRecordsArrayFromResponse(response);
    (results.endpoints as Record<string, unknown>)['records_companyId_query'] = {
      path,
      rawKeys: response && typeof response === 'object' ? Object.keys(response) : [],
      recordsCount: list.length,
      records: list.slice(0, 3).map((r: any) => ({
        date: r?.date ?? r?.datetime,
        visit_id: r?.visit_id ?? r?.visitId,
        services: r?.services ?? r?.data?.services,
        attendance: r?.attendance ?? r?.visit_attendance,
      })),
    };
  } catch (err) {
    (results.endpoints as Record<string, unknown>)['records_companyId_query'] = {
      path: `records?company_id=${companyId}&client_id=${altegioClientId}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({ ok: true, ...results });
}
