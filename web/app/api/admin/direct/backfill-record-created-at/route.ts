// web/app/api/admin/direct/backfill-record-created-at/route.ts
// Backfill consultationRecordCreatedAt та paidServiceRecordCreatedAt з KV в БД.
// Для клієнтів, у яких ці поля порожні, беремо дати з altegio:records:log + webhook:log.

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickRecordCreatedAtISOFromGroup,
  pickClosestConsultGroup,
  pickClosestPaidGroup,
} from '@/lib/altegio/records-grouping';

export const maxDuration = 300;

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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const force = req.nextUrl.searchParams.get('force') === '1';

    console.log('[direct/backfill-record-created-at] Старт backfill дат створення записів з KV', {
      force,
    });

    const allClients = await getAllDirectClients();
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 9999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    let consultationUpdated = 0;
    let paidServiceUpdated = 0;
    let skippedConsultExists = 0;
    let skippedPaidExists = 0;
    let skippedNoAltegioId = 0;
    let skippedNoDataFromKv = 0;
    let errors = 0;

    for (const client of allClients) {
      if (!client.altegioClientId) {
        skippedNoAltegioId++;
        continue;
      }

      const groups = groupsByClient.get(Number(client.altegioClientId)) ?? [];

      try {
        let needsSave = false;
        const updates: Record<string, string | undefined> = {};

        // consultationRecordCreatedAt
        if (client.consultationBookingDate) {
          const consultGroup = pickClosestConsultGroup(groups, client.consultationBookingDate);
          const kvConsultCreatedAt = pickRecordCreatedAtISOFromGroup(consultGroup);
          if (kvConsultCreatedAt) {
            const hasInDb = Boolean(client.consultationRecordCreatedAt);
            if (!hasInDb || force) {
              updates.consultationRecordCreatedAt = kvConsultCreatedAt;
              needsSave = true;
              consultationUpdated++;
            } else {
              skippedConsultExists++;
            }
          } else {
            skippedNoDataFromKv++;
          }
        }

        // paidServiceRecordCreatedAt
        if (client.paidServiceDate) {
          const paidGroup = pickClosestPaidGroup(groups, client.paidServiceDate);
          const kvPaidCreatedAt = pickRecordCreatedAtISOFromGroup(paidGroup);
          if (kvPaidCreatedAt) {
            const hasInDb = Boolean(client.paidServiceRecordCreatedAt);
            if (!hasInDb || force) {
              updates.paidServiceRecordCreatedAt = kvPaidCreatedAt;
              needsSave = true;
              paidServiceUpdated++;
            } else {
              skippedPaidExists++;
            }
          }
        }

        if (needsSave) {
          const updated = {
            ...client,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
          await saveDirectClient(updated, 'backfill-record-created-at', {
            altegioClientId: client.altegioClientId,
            consultationRecordCreatedAt: updates.consultationRecordCreatedAt ?? null,
            paidServiceRecordCreatedAt: updates.paidServiceRecordCreatedAt ?? null,
          }, { touchUpdatedAt: false });
        }
      } catch (err) {
        errors++;
        console.error('[direct/backfill-record-created-at] Помилка для клієнта', {
          id: client.id,
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const ms = Date.now() - startedAt;
    console.log('[direct/backfill-record-created-at] ✅ Готово', {
      totalClients: allClients.length,
      consultationUpdated,
      paidServiceUpdated,
      skippedConsultExists,
      skippedPaidExists,
      skippedNoAltegioId,
      skippedNoDataFromKv,
      errors,
      ms,
    });

    return NextResponse.json({
      ok: true,
      stats: {
        totalClients: allClients.length,
        consultationUpdated,
        paidServiceUpdated,
        skippedConsultExists,
        skippedPaidExists,
        skippedNoAltegioId,
        skippedNoDataFromKv,
        errors,
        ms,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[direct/backfill-record-created-at] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
