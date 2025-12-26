// web/app/api/admin/direct/recover-all-data/route.ts
// Відновлення всіх даних з KV в Postgres

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, directKeys } from '@/lib/kv';
import { saveDirectClient, saveDirectStatus, getAllDirectClients, getAllDirectStatuses } from '@/lib/direct-store';
import type { DirectClient, DirectStatus } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Рекурсивно розгортає KV відповідь
 */
function unwrapKVResponse(data: any, maxAttempts = 20): any {
  let current: any = data;
  let attempts = 0;
  const seenStrings = new Set<string>();
  
  while (attempts < maxAttempts) {
    attempts++;
    
    if (Array.isArray(current)) {
      const filtered = current.filter(item => item !== null && item !== undefined);
      return filtered.length > 0 ? filtered : current;
    }
    
    if (typeof current === 'string') {
      if (!current.trim()) return current;
      const trimmed = current.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        if (seenStrings.has(current)) {
          try {
            const parsed = JSON.parse(current);
            if (Array.isArray(parsed)) {
              return parsed.filter(item => item !== null && item !== undefined);
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const extracted = parsed.value ?? parsed.result ?? parsed.data;
              if (extracted !== undefined && extracted !== null) {
                current = extracted;
                seenStrings.delete(current);
                continue;
              }
            }
            return parsed;
          } catch {
            return current;
          }
        }
        seenStrings.add(current);
        try {
          const parsed = JSON.parse(current);
          current = parsed;
          continue;
        } catch {
          return current;
        }
      } else {
        return current;
      }
    }
    
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const extracted = (current as any).value ?? (current as any).result ?? (current as any).data;
      if (extracted !== undefined && extracted !== null) {
        current = extracted;
        if (typeof extracted === 'string') {
          seenStrings.delete(extracted);
        }
        continue;
      }
    }
    
    if (current === null || current === undefined || typeof current !== 'object') {
      return current;
    }
    
    break;
  }
  
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(current);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => item !== null && item !== undefined);
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const extracted = parsed.value ?? parsed.result ?? parsed.data;
          if (extracted !== undefined && extracted !== null) {
            return unwrapKVResponse(extracted, 5);
          }
        }
        return parsed;
      } catch {
        // Ігноруємо помилку
      }
    }
  }
  
  return current;
}

/**
 * POST - відновити всі дані з KV в Postgres
 */
export async function POST(req: NextRequest) {
  try {
    // Перевіряємо, чи таблиці існують
    try {
      const { prisma } = await import('@/lib/prisma');
      await prisma.$queryRaw`SELECT 1 FROM direct_clients LIMIT 1`.catch(() => {
        throw new Error('Таблиця direct_clients не існує');
      });
      await prisma.$queryRaw`SELECT 1 FROM direct_statuses LIMIT 1`.catch(() => {
        throw new Error('Таблиця direct_statuses не існує');
      });
    } catch (tableError) {
      const errorMsg = tableError instanceof Error ? tableError.message : String(tableError);
      return NextResponse.json({
        ok: false,
        error: 'Таблиці в базі даних не створені',
        message: `Спочатку потрібно створити таблиці через кнопку "🗄️ Створити таблиці"`,
        details: errorMsg,
      }, { status: 400 });
    }

    const stats = {
      clients: { foundInKV: 0, foundInPostgres: 0, migrated: 0, errors: 0, errorsList: [] as string[] },
      statuses: { foundInKV: 0, foundInPostgres: 0, migrated: 0, errors: 0, errorsList: [] as string[] },
    };

    // Перевіряємо поточний стан в Postgres
    const existingClients = await getAllDirectClients();
    const existingStatuses = await getAllDirectStatuses();
    stats.clients.foundInPostgres = existingClients.length;
    stats.statuses.foundInPostgres = existingStatuses.length;

    console.log(`[recover-all-data] Current state: ${existingClients.length} clients, ${existingStatuses.length} statuses in Postgres`);

    // 1. Мігруємо статуси з KV
    console.log('[recover-all-data] Starting statuses recovery from KV...');
    try {
      const statusIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (statusIndex) {
        const parsed = unwrapKVResponse(statusIndex);
        if (Array.isArray(parsed)) {
          const statusIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.length > 0);
          stats.statuses.foundInKV = statusIds.length;
          
          for (const id of statusIds) {
            try {
              // Перевіряємо, чи вже є в Postgres
              const exists = existingStatuses.find(s => s.id === id);
              if (exists) {
                console.log(`[recover-all-data] Status ${id} already exists in Postgres, skipping`);
                continue;
              }

              const statusData = await kvRead.getRaw(directKeys.STATUS_ITEM(id));
              if (statusData) {
                const unwrapped = unwrapKVResponse(statusData);
                let status: any;
                if (typeof unwrapped === 'string') {
                  try {
                    status = JSON.parse(unwrapped);
                  } catch {
                    status = unwrapped;
                  }
                } else {
                  status = unwrapped;
                }
                
                if (status && typeof status === 'object' && status.id && status.name) {
                  const directStatus: DirectStatus = {
                    id: status.id,
                    name: status.name,
                    color: status.color || '#6b7280',
                    order: status.order || 0,
                    isDefault: status.isDefault || false,
                    createdAt: status.createdAt || new Date().toISOString(),
                  };
                  
                  await saveDirectStatus(directStatus);
                  stats.statuses.migrated++;
                  console.log(`[recover-all-data] ✅ Migrated status ${id}: ${directStatus.name}`);
                }
              }
            } catch (err) {
              stats.statuses.errors++;
              const errorMsg = `Status ${id}: ${err instanceof Error ? err.message : String(err)}`;
              stats.statuses.errorsList.push(errorMsg);
              console.error(`[recover-all-data] ❌ ${errorMsg}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[recover-all-data] Failed to recover statuses:', err);
    }

    // 2. Мігруємо клієнтів з KV
    console.log('[recover-all-data] Starting clients recovery from KV...');
    try {
      const clientIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      if (clientIndex) {
        const parsed = unwrapKVResponse(clientIndex);
        if (Array.isArray(parsed)) {
          const clientIds = parsed.filter((id: any): id is string => 
            typeof id === 'string' && id.length > 0 && id.startsWith('direct_')
          );
          stats.clients.foundInKV = clientIds.length;
          
          for (const id of clientIds) {
            try {
              // Перевіряємо, чи вже є в Postgres
              const exists = existingClients.find(c => c.id === id);
              if (exists) {
                console.log(`[recover-all-data] Client ${id} already exists in Postgres, skipping`);
                continue;
              }

              const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
              if (clientData) {
                const unwrapped = unwrapKVResponse(clientData);
                let client: any;
                if (typeof unwrapped === 'string') {
                  try {
                    client = JSON.parse(unwrapped);
                  } catch {
                    client = unwrapped;
                  }
                } else {
                  client = unwrapped;
                }
                
                if (client && typeof client === 'object' &&
                    client.id && client.instagramUsername) {
                  
                  const directClient: DirectClient = {
                    id: client.id,
                    instagramUsername: client.instagramUsername,
                    firstName: client.firstName || undefined,
                    lastName: client.lastName || undefined,
                    source: (client.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
                    state: client.state || undefined,
                    firstContactDate: client.firstContactDate || new Date().toISOString(),
                    statusId: client.statusId || 'new',
                    masterId: client.masterId || undefined,
                    masterManuallySet: client.masterManuallySet ?? false,
                    consultationDate: client.consultationDate || undefined,
                    visitedSalon: client.visitedSalon || false,
                    visitDate: client.visitDate || undefined,
                    signedUpForPaidService: client.signedUpForPaidService || false,
                    paidServiceDate: client.paidServiceDate || undefined,
                    signupAdmin: client.signupAdmin || undefined,
                    comment: client.comment || undefined,
                    altegioClientId: client.altegioClientId || undefined,
                    lastMessageAt: client.lastMessageAt || undefined,
                    createdAt: client.createdAt || new Date().toISOString(),
                    updatedAt: client.updatedAt || new Date().toISOString(),
                  };
                  
                  await saveDirectClient(directClient);
                  stats.clients.migrated++;
                  console.log(`[recover-all-data] ✅ Migrated client ${id}: @${directClient.instagramUsername}`);
                }
              }
            } catch (err) {
              stats.clients.errors++;
              const errorMsg = `Client ${id}: ${err instanceof Error ? err.message : String(err)}`;
              stats.clients.errorsList.push(errorMsg);
              console.error(`[recover-all-data] ❌ ${errorMsg}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[recover-all-data] Failed to recover clients:', err);
    }

    // Перевіряємо фінальний стан
    const finalClients = await getAllDirectClients();
    const finalStatuses = await getAllDirectStatuses();

    return NextResponse.json({
      ok: true,
      message: 'Відновлення даних завершено',
      stats: {
        ...stats,
        final: {
          clients: finalClients.length,
          statuses: finalStatuses.length,
        },
      },
      errors: {
        statuses: stats.statuses.errorsList.slice(0, 10),
        clients: stats.clients.errorsList.slice(0, 10),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[recover-all-data] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
