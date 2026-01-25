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
    
    // Створюємо список адміністраторів та дірект-менеджерів для детального логування
    const adminMasters = masters.filter(m => m.role === 'admin' || m.role === 'direct-manager');
    console.log(`[cleanup-admin-masters] Found ${adminMasters.length} administrators/direct-managers:`, 
      adminMasters.map(m => `${m.name} (${m.role})`).join(', '));

    // Допоміжна функція для перевірки, чи майстер є адміністратором
    // Підтримує часткове співпадіння імен (наприклад, "Вікторія" vs "Вікторія Колачник")
    const isAdminByName = (name: string | null | undefined): boolean => {
      if (!name) return false;
      const n = name.toLowerCase().trim();
      // Спочатку перевіряємо за ім'ям (якщо містить "адм")
      if (isAdminStaffName(n)) return true;
      
      // Точне співпадіння
      const role = masterNameToRole.get(n);
      if (role === 'admin' || role === 'direct-manager') return true;
      
      // Часткове співпадіння: перевіряємо, чи ім'я з serviceMasterName міститься в імені майстра або навпаки
      for (const master of adminMasters) {
        const masterName = (master.name || '').toLowerCase().trim();
        if (!masterName) continue;
        
        // Перевіряємо, чи перше слово співпадає (наприклад, "Вікторія" vs "Вікторія Колачник")
        const nameFirst = n.split(/\s+/)[0] || '';
        const masterFirst = masterName.split(/\s+/)[0] || '';
        if (nameFirst && masterFirst && nameFirst === masterFirst) {
          console.log(`[cleanup-admin-masters] Found admin by first name match: "${n}" matches "${masterName}" (${master.role})`);
          return true;
        }
        
        // Перевіряємо, чи одне ім'я міститься в іншому
        if (n.includes(masterName) || masterName.includes(n)) {
          console.log(`[cleanup-admin-masters] Found admin by partial match: "${n}" matches "${masterName}" (${master.role})`);
          return true;
        }
      }
      
      return false;
    };

    // Завантажуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    console.log(`[cleanup-admin-masters] Found ${allClients.length} clients to check`);

    const clientsToClean: Array<{ id: string; instagramUsername?: string; altegioClientId?: number; serviceMasterName: string }> = [];

    // Знаходимо клієнтів з адміністраторами в serviceMasterName
    let checkedCount = 0;
    let withServiceMasterName = 0;
    for (const client of allClients) {
      checkedCount++;
      const serviceMasterName = (client.serviceMasterName || '').toString().trim();
      if (serviceMasterName) {
        withServiceMasterName++;
        const isAdmin = isAdminByName(serviceMasterName);
        if (isAdmin) {
          clientsToClean.push({
            id: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            serviceMasterName,
          });
          console.log(`[cleanup-admin-masters] Found admin in serviceMasterName: client ${client.id} (@${client.instagramUsername || 'no instagram'}, Altegio ${client.altegioClientId || 'no id'}): "${serviceMasterName}"`);
        }
      }
    }

    console.log(`[cleanup-admin-masters] Checked ${checkedCount} clients, ${withServiceMasterName} with serviceMasterName, found ${clientsToClean.length} with administrators`);

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
