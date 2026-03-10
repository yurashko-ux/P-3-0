// web/app/api/admin/direct/backfill-records-log/route.ts
// Backfill altegio:records:log з Altegio API (GET /records) для клієнтів без історії.
// Потрібен для імпортованих клієнтів, у яких getClientRecordsRaw повернув порожній масив під час імпорту.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import { kvRead, kvWrite } from '@/lib/kv';
import { getEnvValue } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Макс. клієнтів за один запит — уникнення FUNCTION_INVOCATION_TIMEOUT */
const MAX_CLIENTS_PER_REQUEST = 40;

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
 * POST — завантажити записи з Altegio GET /records для клієнтів та пушнути в altegio:records:log.
 * Обробляє до MAX_CLIENTS_PER_REQUEST клієнтів за запит.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  try {
    const allClients = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: { id: true, altegioClientId: true },
    });

    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    const clientIdsWithRecords = new Set<number>();
    for (const raw of rawItems || []) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const cid = parsed?.clientId ?? parsed?.data?.client?.id ?? parsed?.data?.client_id ?? null;
        if (cid != null) clientIdsWithRecords.add(Number(cid));
      } catch {
        /* ignore */
      }
    }

    const clientsWithoutRecords = allClients.filter(
      (c) => c.altegioClientId != null && !clientIdsWithRecords.has(Number(c.altegioClientId))
    );

    const toProcess = clientsWithoutRecords.slice(0, MAX_CLIENTS_PER_REQUEST);
    const remainingCount = Math.max(0, clientsWithoutRecords.length - MAX_CLIENTS_PER_REQUEST);

    let pushed = 0;
    const errors: string[] = [];

    for (const client of toProcess) {
      const altegioId = Number(client.altegioClientId);
      if (!Number.isFinite(altegioId)) continue;

      try {
        const rawRecords = await getClientRecordsRaw(companyId, altegioId);
        for (const rec of rawRecords) {
          if (rec?.deleted) continue;
          const event = rawRecordToRecordEvent(rec, altegioId, companyId);
          if (event.clientId) {
            await kvWrite.lpush('altegio:records:log', JSON.stringify(event));
            pushed++;
          }
        }
        await kvWrite.ltrim('altegio:records:log', 0, 9999);
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Altegio ${altegioId}: ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        clientsWithoutRecords: clientsWithoutRecords.length,
        processed: toProcess.length,
        recordsPushed: pushed,
        remainingCount,
        errors: errors.length,
        errorDetails: errors.slice(0, 5),
      },
      message:
        remainingCount > 0
          ? `Додано ${pushed} записів у KV. Залишилось обробити ${remainingCount} клієнтів без історії — запустіть ще раз.`
          : clientsWithoutRecords.length === 0
            ? 'Усі клієнти вже мають записи в KV.'
            : `Додано ${pushed} записів у KV. Усі клієнти без історії оброблено.`,
    });
  } catch (error) {
    console.error('[backfill-records-log] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
