// web/app/api/admin/direct/cleanup-admin-masters/route.ts
// Очищає serviceMasterName для клієнтів, де встановлено адміністраторів або дірект-менеджерів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { getAllDirectMasters } from '@/lib/direct-masters/store';
import { isAdminStaffName } from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;

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

  try {
    const { searchParams } = req.nextUrl;
    const dryRun = (searchParams.get('dryRun') || '1').toString().trim() !== '0';

    console.log('[cleanup-admin-masters] Starting cleanup of serviceMasterName for administrators...');

    // Завантажуємо всіх майстрів для перевірки ролей
    const masters = await getAllDirectMasters();
    const masterNameToRole = new Map(
      masters.map((m) => [m.name?.toLowerCase().trim() || '', m.role || 'master'])
    );

    // Допоміжна функція для перевірки, чи майстер є адміністратором
    const isAdminByName = (name: string | null | undefined): boolean => {
      if (!name) return false;
      const n = name.toLowerCase().trim();
      // Спочатку перевіряємо за ім'ям (якщо містить "адм")
      if (isAdminStaffName(n)) return true;
      // Потім перевіряємо роль в базі даних
      const role = masterNameToRole.get(n);
      return role === 'admin' || role === 'direct-manager';
    };

    // Завантажуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    console.log(`[cleanup-admin-masters] Found ${allClients.length} clients to check`);

    const clientsToClean: Array<{ id: string; instagramUsername?: string; altegioClientId?: number; serviceMasterName: string }> = [];

    // Знаходимо клієнтів з адміністраторами в serviceMasterName
    for (const client of allClients) {
      const serviceMasterName = (client.serviceMasterName || '').toString().trim();
      if (serviceMasterName && isAdminByName(serviceMasterName)) {
        clientsToClean.push({
          id: client.id,
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          serviceMasterName,
        });
      }
    }

    console.log(`[cleanup-admin-masters] Found ${clientsToClean.length} clients with administrators in serviceMasterName`);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        found: clientsToClean.length,
        clients: clientsToClean.map((c) => ({
          id: c.id,
          instagramUsername: c.instagramUsername,
          altegioClientId: c.altegioClientId,
          serviceMasterName: c.serviceMasterName,
        })),
        note: 'dryRun=1: нічого не змінено. Запусти з dryRun=0 щоб застосувати.',
      });
    }

    // Очищаємо serviceMasterName для знайдених клієнтів
    let cleaned = 0;
    let errors = 0;

    for (const clientInfo of clientsToClean) {
      try {
        const client = allClients.find((c) => c.id === clientInfo.id);
        if (!client) {
          console.warn(`[cleanup-admin-masters] Client ${clientInfo.id} not found`);
          errors++;
          continue;
        }

        const updated = {
          ...client,
          serviceMasterName: undefined,
          serviceMasterAltegioStaffId: null,
          updatedAt: new Date().toISOString(),
        };

        await saveDirectClient(updated, 'cleanup-admin-masters', {
          altegioClientId: client.altegioClientId,
          removedServiceMasterName: clientInfo.serviceMasterName,
        }, { touchUpdatedAt: false, skipLogging: true, skipAltegioMetricsSync: true });

        cleaned++;
        console.log(
          `[cleanup-admin-masters] ✅ Cleaned serviceMasterName for client ${client.id} (${client.instagramUsername || 'no instagram'}, Altegio ${client.altegioClientId || 'no id'}): removed "${clientInfo.serviceMasterName}"`
        );
      } catch (err) {
        errors++;
        console.error(`[cleanup-admin-masters] ❌ Failed to clean client ${clientInfo.id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      found: clientsToClean.length,
      cleaned,
      errors,
      note: `Очищено serviceMasterName для ${cleaned} клієнтів. Помилок: ${errors}.`,
    });
  } catch (error) {
    console.error('[cleanup-admin-masters] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// GET для перевірки без змін
export async function GET(req: NextRequest) {
  return POST(req);
}
