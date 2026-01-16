// web/app/api/cron/update-direct-states/route.ts
// Автоматичне оновлення станів клієнтів раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { groupRecordsByClientDay, normalizeRecordsLogItems, pickNonAdminStaffFromGroup, appendServiceMasterHistory } from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Рекурсивно розгортає KV відповідь
 */
function unwrapKVResponse(data: any): any {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && 'value' in parsed) {
        return unwrapKVResponse(parsed.value);
      }
      return parsed;
    } catch {
      return data;
    }
  }
  if (data && typeof data === 'object' && 'value' in data) {
    return unwrapKVResponse(data.value);
  }
  return data;
}

/**
 * GET - викликається cron job для автоматичного оновлення станів
 */
export async function GET(req: NextRequest) {
  try {
    // Перевірка авторизації через CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    const secretParam = req.nextUrl.searchParams.get('secret');
    
    if (cronSecret) {
      const isAuthorized = 
        authHeader === `Bearer ${cronSecret}` ||
        secretParam === cronSecret;
      
      if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('[cron/update-direct-states] Starting automatic state update...');

    // Отримуємо всіх клієнтів з Direct Manager
    const allClients = await getAllDirectClients();
    console.log(`[cron/update-direct-states] Found ${allClients.length} clients in Direct Manager`);

    // Отримуємо всі записи з Altegio records log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[cron/update-direct-states] Found ${recordsLogRaw.length} records in Altegio log`);

    // Нормалізуємо records:log та групуємо по дню (Europe/Kyiv) і типу (consultation|paid)
    // Це прибирає дублікати "в 4 руки" і не дає attendance/state перетиратись.
    const normalizedEvents = normalizeRecordsLogItems(recordsLogRaw);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    console.log(`[cron/update-direct-states] Normalized events: ${normalizedEvents.length}, grouped clients: ${groupsByClient.size}`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Оновлюємо стани клієнтів
    for (const client of allClients) {
      if (!client.altegioClientId) {
        skippedCount++;
        continue;
      }

      const groups = groupsByClient.get(client.altegioClientId) || [];
      if (groups.length === 0) {
        skippedCount++;
        continue;
      }
      
      // Беремо найновішу paid-групу, якщо є; інакше consultation
      const latestPaid = groups.find((g) => g.groupType === 'paid') || null;
      const latestConsultation = groups.find((g) => g.groupType === 'consultation') || null;
      const chosen = latestPaid || latestConsultation;
      if (!chosen) {
        skippedCount++;
        continue;
      }

      const newState =
        chosen.groupType === 'consultation'
          ? 'consultation'
          : (determineStateFromServices(chosen.services) || 'other-services');

      const picked = pickNonAdminStaffFromGroup(chosen, 'latest');
      const needsMasterUpdate =
        !!picked?.staffName && (client.serviceMasterName || '').trim() !== picked.staffName.trim();

      // Якщо знайшли новий стан і він відрізняється від поточного - оновлюємо
      if ((newState && client.state !== newState) || needsMasterUpdate) {
        try {
          const updated: typeof client = {
            ...client,
            ...(newState && client.state !== newState ? { state: newState } : {}),
            ...(needsMasterUpdate
              ? {
                  serviceMasterName: picked!.staffName,
                  serviceMasterAltegioStaffId: picked!.staffId ?? null,
                  serviceMasterHistory: appendServiceMasterHistory(client.serviceMasterHistory, {
                    kyivDay: chosen.kyivDay,
                    masterName: picked!.staffName,
                    source: 'records-group',
                  }),
                }
              : {}),
            updatedAt: new Date().toISOString(),
          };
          await saveDirectClient(updated, 'cron-update-states', {
            altegioClientId: client.altegioClientId,
            groupType: chosen.groupType,
            visitDayKyiv: chosen.kyivDay,
            services: (chosen.services || []).map((s: any) => ({ id: s.id, title: s.title || s.name })) || [],
          });
          updatedCount++;
          const changes = [];
          if (newState && client.state !== newState) changes.push(`state: '${client.state}' -> '${newState}'`);
          if (needsMasterUpdate) changes.push(`serviceMasterName: '${client.serviceMasterName || '-'}' -> '${picked!.staffName}'`);
          console.log(`[cron/update-direct-states] ✅ Updated client ${client.id} (Altegio ${client.altegioClientId}): ${changes.join(', ')}`);
        } catch (err) {
          const errorMsg = `Failed to update client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(errorMsg);
          console.error(`[cron/update-direct-states] ❌ ${errorMsg}`);
        }
      } else {
        skippedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Automatic state update completed',
      stats: {
        totalClients: allClients.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 5) : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron/update-direct-states] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
