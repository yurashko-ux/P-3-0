// web/app/api/admin/direct/migrate-data/route.ts
// Скрипт міграції даних з KV → Postgres

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, directKeys } from '@/lib/kv';
import { saveDirectClient, saveDirectStatus, getAllDirectStatuses } from '@/lib/direct-store';
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
 * POST - виконати міграцію даних з KV → Postgres
 */
export async function POST(req: NextRequest) {
  try {
    const stats = {
      clients: { found: 0, migrated: 0, errors: 0, errorsList: [] as string[] },
      statuses: { found: 0, migrated: 0, errors: 0, errorsList: [] as string[] },
    };
    
    // 1. Мігруємо статуси
    console.log('[migrate-data] Starting statuses migration...');
    try {
      const statusIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (statusIndex) {
        const parsed = unwrapKVResponse(statusIndex);
        if (Array.isArray(parsed)) {
          const statusIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.length > 0);
          stats.statuses.found = statusIds.length;
          
          for (const id of statusIds) {
            try {
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
                  await saveDirectStatus(status as DirectStatus);
                  stats.statuses.migrated++;
                } else {
                  stats.statuses.errors++;
                  stats.statuses.errorsList.push(`Invalid status ${id}`);
                }
              }
            } catch (err) {
              stats.statuses.errors++;
              stats.statuses.errorsList.push(`Status ${id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[migrate-data] Statuses migration error:', err);
    }
    
    // 2. Мігруємо клієнтів
    console.log('[migrate-data] Starting clients migration...');
    try {
      const clientIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      if (clientIndex) {
        const parsed = unwrapKVResponse(clientIndex);
        if (Array.isArray(parsed)) {
          const clientIds = parsed.filter((id: any): id is string => 
            typeof id === 'string' && id.length > 0 && id.startsWith('direct_')
          );
          stats.clients.found = clientIds.length;
          
          for (const id of clientIds) {
            try {
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
                
                if (client && typeof client === 'object' && client.id && client.instagramUsername) {
                  await saveDirectClient(client as DirectClient);
                  stats.clients.migrated++;
                } else {
                  stats.clients.errors++;
                  stats.clients.errorsList.push(`Invalid client ${id}`);
                }
              }
            } catch (err) {
              stats.clients.errors++;
              stats.clients.errorsList.push(`Client ${id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[migrate-data] Clients migration error:', err);
    }
    
    // 3. Перевіряємо результат
    const finalStatuses = await getAllDirectStatuses();
    
    return NextResponse.json({
      ok: true,
      message: 'Міграція завершена',
      stats: {
        statuses: {
          found: stats.statuses.found,
          migrated: stats.statuses.migrated,
          errors: stats.statuses.errors,
          finalCount: finalStatuses.length,
        },
        clients: {
          found: stats.clients.found,
          migrated: stats.clients.migrated,
          errors: stats.clients.errors,
        },
      },
      errors: {
        statuses: stats.statuses.errorsList.slice(0, 10),
        clients: stats.clients.errorsList.slice(0, 10),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[migrate-data] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
