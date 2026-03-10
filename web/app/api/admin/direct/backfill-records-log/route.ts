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

const KV_ATTEMPTED_KEY = 'backfill-records-log:attempted';

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

  const reset = req.nextUrl.searchParams.get('reset') === '1';

  try {
    const allClients = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: { id: true, altegioClientId: true },
      orderBy: { id: 'asc' },
    });

    let attemptedSet = new Set<number>();
    if (!reset) {
      try {
        const raw = await kvRead.getRaw(KV_ATTEMPTED_KEY);
        if (raw && typeof raw === 'string') {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            attemptedSet = new Set(arr.map((x: unknown) => Number(x)).filter((n) => Number.isFinite(n)));
          }
        }
      } catch {
        /* ignore */
      }
    }

    const clientsToProcess = allClients.filter(
      (c) => c.altegioClientId != null && !attemptedSet.has(Number(c.altegioClientId))
    );

    const toProcess = clientsToProcess.slice(0, MAX_CLIENTS_PER_REQUEST);
    const remainingCount = Math.max(0, clientsToProcess.length - MAX_CLIENTS_PER_REQUEST);

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
      attemptedSet.add(altegioId);
    }

    if (toProcess.length > 0) {
      const newAttempted = Array.from(new Set([...attemptedSet]));
      await kvWrite.setRaw(KV_ATTEMPTED_KEY, JSON.stringify(newAttempted));
    }

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        alreadyAttempted: attemptedSet.size,
        clientsToProcess: clientsToProcess.length,
        processed: toProcess.length,
        recordsPushed: pushed,
        remainingCount,
        errors: errors.length,
        errorDetails: errors.slice(0, 5),
      },
      message:
        remainingCount > 0
          ? `Додано ${pushed} записів у KV. Залишилось обробити ${remainingCount} клієнтів — запустіть ще раз.`
          : clientsToProcess.length === 0
            ? 'Усі клієнти вже оброблено.'
            : `Додано ${pushed} записів у KV. Усі клієнти оброблено.`,
    });
  } catch (error) {
    console.error('[backfill-records-log] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
