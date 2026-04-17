// web/app/api/admin/direct/sync-altegio-bulk/route.ts
// Масове завантаження клієнтів з Altegio в Direct Manager

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { altegioFetch } from '@/lib/altegio/client';
import { getEnvValue } from '@/lib/env';
import { normalizeInstagram } from '@/lib/normalize';
import { determineStateFromRecordsLog } from '@/lib/direct-state-helper';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import { kvRead, kvWrite } from '@/lib/kv';
import { buildAltegioFallbackInstagramUsername } from '@/lib/altegio/client-utils';

export const maxDuration = 300; // Pro: 5 хв. Масове завантаження з Altegio.

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
 * Витягує Instagram username з клієнта Altegio
 * 
 * ВАЖЛИВО: Altegio повертає custom_fields як масив об'єктів з структурою:
 * {
 *   "custom_fields": [
 *     {
 *       "id": 77,
 *       "title": "Instagram user name",
 *       "value": "my_instagram"
 *     }
 *   ]
 * }
 * 
 * API key "instagram-user-name" використовується тільки для UPDATE, не для READ!
 */
function extractInstagramFromAltegioClient(client: any): string | null {
  // Логуємо структуру клієнта для діагностики
  if (client.id === 176404915) {
    console.log(`[direct/sync-altegio-bulk] DEBUG: Extracting Instagram for client ${client.id}:`, {
      name: client.name,
      custom_fields: client.custom_fields,
      custom_fields_type: typeof client.custom_fields,
      custom_fields_isArray: Array.isArray(client.custom_fields),
      custom_fields_length: Array.isArray(client.custom_fields) ? client.custom_fields.length : 0,
      all_keys: Object.keys(client),
      full_custom_fields: JSON.stringify(client.custom_fields, null, 2),
    });
  }

  // Перевіряємо різні варіанти назв полів Instagram
  const instagramFields: (string | null)[] = [
    // Прямі поля (на випадок, якщо вони є)
    client['instagram-user-name'],
    client.instagram_user_name,
    client.instagramUsername,
    client.instagram_username,
    client.instagram,
    client['instagram'],
  ];

  // ВАЖЛИВО: Altegio повертає custom_fields як МАСИВ об'єктів з title/value
  if (Array.isArray(client.custom_fields)) {
    for (const field of client.custom_fields) {
      if (field && typeof field === 'object') {
        const title = field.title || field.name || field.label || '';
        const value = field.value || field.data || field.content || field.text || '';
        
        // Шукаємо по title (найпростіший спосіб)
        // Можливі варіанти: "Instagram user name", "Instagram username", "Instagram", тощо
        if (value && typeof value === 'string' && /instagram/i.test(title)) {
          instagramFields.push(value);
          if (client.id === 176404915) {
            console.log(`[direct/sync-altegio-bulk] DEBUG: Found Instagram by title "${title}": ${value}`);
          }
        }
        
        // Також перевіряємо по id (якщо знаємо id поля - 76671 з метаданих)
        // Але це менш надійно, бо id може відрізнятися для різних компаній
        if (field.id === 76671 && value && typeof value === 'string') {
          instagramFields.push(value);
          if (client.id === 176404915) {
            console.log(`[direct/sync-altegio-bulk] DEBUG: Found Instagram by field id 76671: ${value}`);
          }
        }
      }
    }
  }
  
  // Fallback: якщо custom_fields - це об'єкт (старий формат або інша структура)
  if (client.custom_fields && typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
    const objFields = [
      client.custom_fields['instagram-user-name'],
      client.custom_fields['Instagram user name'],
      client.custom_fields['Instagram username'],
      client.custom_fields.instagram_user_name,
      client.custom_fields.instagramUsername,
      client.custom_fields.instagram_username,
      client.custom_fields.instagram,
      client.custom_fields['instagram'],
    ];
    instagramFields.push(...objFields);
  }

  for (const field of instagramFields) {
    if (field && typeof field === 'string' && field.trim()) {
      const normalized = normalizeInstagram(field.trim());
      if (normalized) {
        if (client.id === 176404915) {
          console.log(`[direct/sync-altegio-bulk] DEBUG: Found Instagram for client ${client.id}:`, {
            original: field,
            normalized,
          });
        }
        return normalized;
      }
    }
  }

  if (client.id === 176404915) {
    console.log(`[direct/sync-altegio-bulk] DEBUG: No Instagram found for client ${client.id}`);
  }

  return null;
}

/**
 * Витягує повне ім'я з клієнта Altegio
 */
function extractNameFromAltegioClient(client: any): { firstName?: string; lastName?: string } {
  if (!client.name) {
    return {};
  }

  const nameParts = client.name.trim().split(/\s+/);
  if (nameParts.length === 0) {
    return {};
  }

  if (nameParts.length === 1) {
    return { firstName: nameParts[0] };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}

/**
 * POST - масове завантаження клієнтів з Altegio
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text?.trim()) body = JSON.parse(text);
    } catch {
      // порожній або невалідний body — нормально для POST без body
    }
    const location_id = body.location_id as string | number | undefined;
    const max_clients = typeof body.max_clients === 'number' ? body.max_clients : 40;
    const skip = typeof body.skip === 'number' && body.skip >= 0 ? body.skip : 0;
    const page_size = typeof body.page_size === 'number' ? body.page_size : 100;
    const fallbackNewOnly = body.fallbackNewOnly === true;
    const syncIncompleteOnly = body.syncIncompleteOnly === true; // тільки «Новий» з порожніми visits/lastVisitAt

    // Визначаємо, чи це тестовий режим (якщо вказано max_clients явно в body)
    const isTestMode = !!max_clients && max_clients > 0;

    // Отримуємо location_id з body або з env
    const companyIdStr = (location_id != null ? String(location_id).trim() : '') || getEnvValue('ALTEGIO_COMPANY_ID');
    if (!companyIdStr) {
      return NextResponse.json(
        { ok: false, error: 'Altegio location_id (company_id) not provided' },
        { status: 400 }
      );
    }

    const companyId = parseInt(companyIdStr, 10);
    if (isNaN(companyId)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid Altegio location_id (must be a number)' },
        { status: 400 }
      );
    }

    console.log(`[direct/sync-altegio-bulk] Starting bulk sync location_id=${companyId}, max_clients=${max_clients}, skip=${skip}, fallbackNewOnly=${fallbackNewOnly}`);

    let existingDirectClients: Awaited<ReturnType<typeof getAllDirectClients>> = [];
    const existingInstagramMap = new Map<string, string>();
    const existingAltegioIdMap = new Map<number, string>();
    if (!fallbackNewOnly) {
      existingDirectClients = await getAllDirectClients();
      for (const client of existingDirectClients) {
        const normalized = normalizeInstagram(client.instagramUsername);
        if (normalized) existingInstagramMap.set(normalized, client.id);
        if (client.altegioClientId) existingAltegioIdMap.set(client.altegioClientId, client.id);
      }
    }

    let page = 1;
    let totalProcessed = 0;
    let totalSkipped = 0; // для skip — скільки пропустили до початку обробки
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkippedNoInstagram = 0;
    let totalSkippedDuplicate = 0;
    let totalSkippedExisting = 0;
    let totalRecordsPushedToKV = 0;
    const syncedClientIds: string[] = [];
    const syncedAltegioIds: number[] = [];

    // Завантажуємо клієнтів з Altegio (пропускаємо, якщо fallbackNewOnly — тільки «Новий» з Direct)
    if (!fallbackNewOnly) {
    while (true) {
      // Перевіряємо ліміт
      if (max_clients && totalProcessed >= max_clients) {
        console.log(`[direct/sync-altegio-bulk] Reached max_clients limit: ${max_clients}`);
        break;
      }

      const currentPageSize = max_clients
        ? Math.min(page_size, max_clients - totalProcessed)
        : page_size;

      console.log(`[direct/sync-altegio-bulk] Fetching page ${page} with page_size=${currentPageSize}...`);

      try {
        // Використовуємо новий endpoint згідно з документацією
        const response = await altegioFetch<{
          data?: any[];
          clients?: any[];
          items?: any[];
          meta?: { total?: number; last_page?: number };
        }>(
          `/company/${companyId}/clients/search`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              page,
              page_size: currentPageSize,
              // ВАЖЛИВО згідно з чек-листом:
              // clients/search — не очікувати custom_fields (це обмеження API, не баг)
              // custom_fields читати лише з GET /company/{location}/clients/{id}
              // Потрібен flow: search → get by id
              fields: ['id', 'name', 'phone', 'email'], // Не вказуємо custom_fields, бо вони все одно не повертаються
              order_by: 'last_visit_date',
              order_by_direction: 'desc',
            }),
          }
        );

        // Обробляємо відповідь
        let clients: any[] = [];
        if (Array.isArray(response)) {
          clients = response;
        } else if (response && typeof response === 'object') {
          if ('data' in response && Array.isArray(response.data)) {
            clients = response.data;
          } else if ('clients' in response && Array.isArray(response.clients)) {
            clients = response.clients;
          } else if ('items' in response && Array.isArray(response.items)) {
            clients = response.items;
          }
        }

        if (clients.length === 0) {
          console.log(`[direct/sync-altegio-bulk] No more clients on page ${page}`);
          break;
        }

        console.log(`[direct/sync-altegio-bulk] Received ${clients.length} clients from page ${page}`);
        
        // Логуємо структуру першого клієнта для діагностики
        if (clients.length > 0 && page === 1) {
          console.log(`[direct/sync-altegio-bulk] Sample client structure from search (first client):`, {
            id: clients[0].id,
            name: clients[0].name,
            allKeys: Object.keys(clients[0]),
            hasCustomFields: !!clients[0].custom_fields,
            note: '⚠️ /clients/search never returns custom_fields by design',
          });
        }

        // Обробляємо кожного клієнта
        for (const altegioClient of clients) {
          // Пропускаємо перші skip клієнтів (для батчевої обробки)
          if (totalSkipped < skip) {
            totalSkipped++;
            continue;
          }

          totalProcessed++;

          // Перевіряємо ліміт перед обробкою
          if (max_clients && totalProcessed > max_clients) {
            break;
          }

          // Існуючі клієнти в Direct — не чіпаємо профіль. Лише додаємо до sync-visit-history + backfill.
          const existingByAltegioId = existingAltegioIdMap.get(altegioClient.id);
          if (existingByAltegioId) {
            syncedAltegioIds.push(altegioClient.id);
            totalSkippedExisting++;
            continue;
          }

          // ВАЖЛИВО: Altegio API limitation
          // /clients/search НІКОЛИ не повертає custom_fields (це обмеження API, не баг)
          // custom_fields доступні ТІЛЬКИ через GET /clients/{id}
          // Потрібен flow: search → get by id (як роблять усі інтеграції з Altegio)
          let fullClientData = altegioClient;
          let instagramUsername: string | null = null;

          try {
            // ВАЖЛИВО згідно з чек-листом:
            // 1. Використовувати User Token, не Partner (altegioFetch використовує altegioHeaders, який перевіряє USER_TOKEN)
            // 2. User Token має доступ до location (companyId)
            // 3. clients/search — не очікувати custom_fields (вже зроблено)
            // 4. custom_fields читати лише з GET /company/{location}/clients/{id}
            // Правильний endpoint - GET /company/{company_id}/clients/{client_id}
            // /clients/{id} НЕ існує (404 був через неправильний endpoint)
            const correctEndpoint = `/company/${companyId}/clients/${altegioClient.id}`;
            
            const detailedClient = await altegioFetch<any>(correctEndpoint, {
              method: 'GET',
              headers: {
                'Accept': 'application/json', // Важливо для Altegio API
                'Content-Type': 'application/json',
              },
            });
            
            // Обробляємо різні формати відповіді
            let client: any = null;
            if (detailedClient && typeof detailedClient === 'object') {
              if ('id' in detailedClient && detailedClient.id === altegioClient.id) {
                client = detailedClient;
              } else if ('data' in detailedClient && detailedClient.data && detailedClient.data.id === altegioClient.id) {
                client = detailedClient.data;
              }
            }
            
            if (client && client.id === altegioClient.id) {
              fullClientData = client;
              console.log(`[direct/sync-altegio-bulk] ✅ Got full client data for ${altegioClient.id} via ${correctEndpoint}`);
              
              // Детальне логування для проблемного клієнта
              if (altegioClient.id === 176404915) {
                console.log(`[direct/sync-altegio-bulk] DEBUG: Full client data for ${altegioClient.id}:`, {
                  id: fullClientData.id,
                  name: fullClientData.name,
                  allKeys: Object.keys(fullClientData),
                  custom_fields: fullClientData.custom_fields,
                  custom_fields_type: typeof fullClientData.custom_fields,
                  custom_fields_isArray: Array.isArray(fullClientData.custom_fields),
                  fullClient: JSON.stringify(fullClientData, null, 2).substring(0, 1000),
                });
              }
            } else {
              console.warn(`[direct/sync-altegio-bulk] Client ID mismatch for ${altegioClient.id} via ${correctEndpoint}`);
            }
            
            // Затримка між запитами для уникнення rate limiting (200 запитів/хвилину або 5/секунду)
            await new Promise(resolve => setTimeout(resolve, 250)); // 250ms = 4 запити/секунду
          } catch (err) {
            console.warn(`[direct/sync-altegio-bulk] Failed to get full client data for ${altegioClient.id}:`, err);
            if (altegioClient.id === 176404915) {
              console.log(`[direct/sync-altegio-bulk] DEBUG: Error details:`, err instanceof Error ? err.message : String(err));
            }
          }

          // Витягуємо Instagram username з повних даних клієнта
          instagramUsername = extractInstagramFromAltegioClient(fullClientData);
          
          if (!instagramUsername && altegioClient.id === 176404915) {
            console.log(`[direct/sync-altegio-bulk] ⚠️ WARNING: Instagram not found for client ${altegioClient.id} even after fetching full data.`);
            console.log(`[direct/sync-altegio-bulk] Full client data keys:`, Object.keys(fullClientData));
            console.log(`[direct/sync-altegio-bulk] Custom fields:`, fullClientData.custom_fields);
          }
          
          // Якщо Instagram відсутній у custom_fields Altegio — не пропускаємо клієнта.
          // Генеруємо технічний username так само, як у import-altegio-full,
          // щоб клієнт потрапив у Direct і далі нормально синхронізувався.
          if (!instagramUsername) {
            const { firstName, lastName } = extractNameFromAltegioClient(altegioClient);
            instagramUsername = buildAltegioFallbackInstagramUsername(altegioClient.id, firstName, lastName);
            if (isTestMode || altegioClient.id === 176404915) {
              console.log(`[direct/sync-altegio-bulk] Generated fallback username for client ${altegioClient.id}: ${instagramUsername}`);
            }
          }

          if (!instagramUsername) {
            totalSkippedNoInstagram++;
            continue;
          }

          // Перевіряємо дублікати до records fetch — існуючі лише додаємо до sync-visit-history
          const normalizedInstagram = normalizeInstagram(instagramUsername);
          let existingClientId = existingInstagramMap.get(normalizedInstagram);
          let foundByInstagram = !!existingClientId;
          if (!existingClientId && altegioClient.id) {
            existingClientId = existingAltegioIdMap.get(altegioClient.id);
          }
          if (foundByInstagram && existingClientId && altegioClient.id) {
            const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
            if (existingClient && existingClient.altegioClientId && existingClient.altegioClientId !== altegioClient.id) {
              const clientByAltegioId = existingAltegioIdMap.get(altegioClient.id);
              if (clientByAltegioId) {
                existingClientId = clientByAltegioId;
              }
            }
          }
          if (existingClientId) {
            syncedAltegioIds.push(altegioClient.id);
            totalSkippedExisting++;
            continue;
          }

          // Records в KV (лише для нових клієнтів)
          try {
            const rawRecords = await getClientRecordsRaw(companyId, altegioClient.id);
            for (const rec of rawRecords) {
              if (rec?.deleted) continue;
              const event = rawRecordToRecordEvent(rec, altegioClient.id, companyId);
              if (event.clientId) {
                await kvWrite.lpush('altegio:records:log', JSON.stringify(event));
                totalRecordsPushedToKV++;
              }
            }
            await kvWrite.ltrim('altegio:records:log', 0, 9999);
            await new Promise((r) => setTimeout(r, 100)); // rate limit
          } catch (recordsErr) {
            console.warn(`[direct/sync-altegio-bulk] Не вдалося завантажити records для ${altegioClient.id}:`, recordsErr);
          }

          const phoneFromAltegio = (fullClientData?.phone ?? altegioClient?.phone ?? '').toString().trim();
          const { firstName, lastName } = extractNameFromAltegioClient(altegioClient);
          const determinedState = await determineStateFromRecordsLog(altegioClient.id, kvRead);

          {
            // Створюємо нового клієнта
            const now = new Date().toISOString();
            const newClient = {
              id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              ...(phoneFromAltegio ? { phone: phoneFromAltegio } : {}),
              source: 'instagram' as const,
              state: (determinedState || 'client') as 'consultation' | 'hair-extension' | 'other-services' | 'client', // Встановлюємо стан на основі послуг
              firstContactDate: now,
              statusId: 'client', // Клієнт з Altegio — статус "Клієнт"
              visitedSalon: false,
              signedUpForPaidService: false,
              altegioClientId: altegioClient.id,
              createdAt: now,
              updatedAt: now,
            };

            await saveDirectClient(newClient, 'sync-altegio-bulk', { altegioClientId: altegioClient.id }, { touchUpdatedAt: false });
            
            // Синхронізуємо lastVisitAt з Altegio для нового клієнта
            if (altegioClient.id) {
              try {
                const { getClient } = await import('@/lib/altegio/clients');
                const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
                const companyId = parseInt(companyIdStr, 10);
                if (companyId && !Number.isNaN(companyId)) {
                  const altegioClientData = await getClient(companyId, altegioClient.id);
                  const raw = (altegioClientData as any)?.last_visit_date ?? (altegioClientData as any)?.lastVisitDate ?? null;
                  const s = raw ? String(raw).trim() : '';
                  if (s) {
                    const d = new Date(s);
                    if (!isNaN(d.getTime())) {
                      const syncedLastVisitAt = d.toISOString();
                      const clientWithLastVisit = {
                        ...newClient,
                        lastVisitAt: syncedLastVisitAt,
                        updatedAt: newClient.updatedAt, // Не рухаємо updatedAt
                      };
                      await saveDirectClient(clientWithLastVisit, 'sync-altegio-bulk-sync-last-visit', { altegioClientId: altegioClient.id }, { touchUpdatedAt: false, skipAltegioMetricsSync: true });
                      console.log(`[sync-altegio-bulk] ✅ Synced lastVisitAt for new client ${newClient.id}: ${syncedLastVisitAt}`);
                    }
                  }
                }
              } catch (err) {
                console.warn(`[sync-altegio-bulk] ⚠️ Не вдалося синхронізувати lastVisitAt для нового клієнта ${newClient.id} (не критично):`, err);
              }
            }
            
            totalCreated++;
            syncedClientIds.push(newClient.id);
            syncedAltegioIds.push(altegioClient.id);
            existingInstagramMap.set(normalizedInstagram, newClient.id);
            // Додаємо в мапу по altegioClientId для майбутніх оновлень
            if (altegioClient.id) {
              existingAltegioIdMap.set(altegioClient.id, newClient.id);
            }
          }
        }

        // Перевіряємо, чи є ще сторінки
        const meta = response && typeof response === 'object' && 'meta' in response ? response.meta : null;
        if (meta && meta.last_page && page >= meta.last_page) {
          console.log(`[direct/sync-altegio-bulk] Reached last page: ${meta.last_page}`);
          break;
        }

        // Якщо отримали менше клієнтів, ніж page_size, це остання сторінка
        if (clients.length < currentPageSize) {
          console.log(`[direct/sync-altegio-bulk] Last page reached (received ${clients.length} < ${currentPageSize})`);
          break;
        }

        page++;

        // Невелика затримка між сторінками для rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[direct/sync-altegio-bulk] Error fetching page ${page}:`, error);
        // Якщо помилка на першій сторінці, викидаємо помилку
        if (page === 1) {
          throw error;
        }
        // Якщо помилка на наступних сторінках, просто зупиняємося
        break;
      }
    }
    } else {
      console.log(`[direct/sync-altegio-bulk] fallbackNewOnly: пропускаємо Altegio, тільки «Новий» з Direct skip=${skip}`);
    }

    console.log(`[direct/sync-altegio-bulk] Sync completed:`, {
      totalProcessed,
      totalCreated,
      totalUpdated,
      totalSkippedExisting,
      totalRecordsPushedToKV,
      syncedAltegioIds: syncedAltegioIds.length,
    });

    // StatusId з назвою «Новий» — можуть бути кілька (синій id=new, зелений — інший id)
    const newStatusRows = await prisma.directStatus.findMany({
      where: { name: 'Новий' },
      select: { id: true },
    });
    const newStatusIds = newStatusRows.length > 0
      ? newStatusRows.map((s) => s.id).filter(Boolean)
      : ['new'];

    // Тільки клієнти зі статусом «Новий» (будь-який з id)
    let clientsToUpdate: Array<{ name: string; instagramUsername: string | null; altegioClientId: number }> = [];
    if (syncedAltegioIds.length > 0) {
      const clientsNew = await prisma.directClient.findMany({
        where: {
          altegioClientId: { in: syncedAltegioIds },
          statusId: newStatusIds.length === 1 ? newStatusIds[0] : { in: newStatusIds },
        },
        select: {
          firstName: true,
          lastName: true,
          instagramUsername: true,
          altegioClientId: true,
        },
      });
      clientsToUpdate = clientsNew.map((c) => ({
        name: [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.instagramUsername || '—',
        instagramUsername: c.instagramUsername,
        altegioClientId: c.altegioClientId!,
      }));
    }
    let altegioIdsNewOnly = clientsToUpdate.map((c) => c.altegioClientId);
    let syncedAllNewFallback = false;

    // Якщо в батчі 0 клієнтів «Новий» — додатково синхронізуємо з Direct. syncIncompleteOnly = тільки з порожніми visits/lastVisitAt
    if (altegioIdsNewOnly.length === 0 && newStatusIds.length > 0) {
      const baseWhere = {
        statusId: newStatusIds.length === 1 ? newStatusIds[0] : { in: newStatusIds },
        altegioClientId: { not: null } as const,
      };
      const where = syncIncompleteOnly
        ? { ...baseWhere, OR: [{ visits: null }, { lastVisitAt: null }] }
        : baseWhere;
      const allNew = await prisma.directClient.findMany({
        where,
        select: { altegioClientId: true, firstName: true, lastName: true, instagramUsername: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: 80,
      });
      if (allNew.length > 0) {
        altegioIdsNewOnly = allNew.map((c) => c.altegioClientId!);
        clientsToUpdate = allNew.map((c) => ({
          name: [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.instagramUsername || '—',
          instagramUsername: c.instagramUsername,
          altegioClientId: c.altegioClientId!,
        }));
        syncedAllNewFallback = true;
        console.log(`[sync-altegio-bulk] Fallback: sync «Новий» з Direct skip=${skip}, incompleteOnly=${syncIncompleteOnly}, отримано ${allNew.length}`);
      }
    }

    // Sync visit history та backfill breakdown
    const getBaseUrl = () => {
      const vercel = process.env.VERCEL_URL?.trim();
      if (vercel) return `https://${vercel}`;
      return `http://127.0.0.1:${process.env.PORT || 3000}`;
    };
    const baseUrl = getBaseUrl();
    const authParam = CRON_SECRET ? `&secret=${encodeURIComponent(CRON_SECRET)}` : '';
    let syncVisitStats: { updated?: number; errors?: number } | null = null;
    let backfillStats: { updated?: number; reason?: string } | null = null;

    if (altegioIdsNewOnly.length > 0) {
      const idsParam = `altegioClientIds=${altegioIdsNewOnly.join(',')}`;
      const statusParam = `statusIds=${encodeURIComponent(newStatusIds.join(','))}`;
      try {
        const syncRes = await fetch(
          `${baseUrl}/api/admin/direct/sync-visit-history-from-api?${idsParam}&${statusParam}&delayMs=150${authParam}`,
          { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
        );
        const syncText = await syncRes.text();
        let syncData: Record<string, unknown> = {};
        if (syncText?.trim()) {
          try {
            syncData = JSON.parse(syncText);
          } catch {
            console.warn('[sync-altegio-bulk] sync-visit-history повернув не-JSON:', syncText?.slice(0, 200));
          }
        }
        const s = (syncData as { stats?: { updated?: number; errors?: number } }).stats;
        if (s) {
          syncVisitStats = {
            updated: s.updated ?? 0,
            errors: s.errors ?? 0,
          };
        }
      } catch (syncErr) {
        console.warn('[sync-altegio-bulk] sync-visit-history failed:', syncErr);
        syncVisitStats = { errors: 1 };
      }

      try {
        const breakdownRes = await fetch(
          `${baseUrl}/api/admin/direct/backfill-visit-breakdown?${idsParam}&${statusParam}${authParam}`,
          { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
        );
        const breakdownText = await breakdownRes.text();
        let breakdownData: Record<string, unknown> = {};
        if (breakdownText?.trim()) {
          try {
            breakdownData = JSON.parse(breakdownText);
          } catch {
            console.warn('[sync-altegio-bulk] backfill-visit-breakdown повернув не-JSON:', breakdownText?.slice(0, 200));
          }
        }
        const b = breakdownData as { updated?: number; reason?: string };
        if (b?.updated != null || b?.reason) {
          backfillStats = {
            updated: b.updated,
            reason: b.reason,
          };
        }
      } catch (breakdownErr) {
        console.warn('[sync-altegio-bulk] backfill-visit-breakdown failed:', breakdownErr);
      }
    }

    return NextResponse.json({
      ok: true,
      stats: {
        totalProcessed,
        totalCreated,
        totalUpdated,
        totalSkippedExisting,
        totalSkippedNoInstagram,
        totalSkippedDuplicate,
        totalRecordsPushedToKV,
        syncedAltegioIds: syncedAltegioIds.length,
        clientsToUpdateCount: clientsToUpdate.length,
        newStatusIds,
        syncedAllNewFallback,
        syncIncompleteOnly,
        syncVisitHistory: syncVisitStats,
        backfillBreakdown: backfillStats,
      },
      clientsToUpdate,
      message: `Створено: ${totalCreated}. Існуючих: ${totalSkippedExisting}. Клієнтів «Новий»: ${clientsToUpdate.length}${syncedAllNewFallback ? ` (fallback skip=${skip}). Для наступних «Новий»: skip=${skip + 80}` : ''}. Sync visit: ${syncVisitStats?.updated ?? 0} оновлено. Backfill: ${backfillStats?.updated ?? 0}. Для Altegio батчу: skip=${totalProcessed + skip}.`,
    });
  } catch (error) {
    console.error('[direct/sync-altegio-bulk] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

