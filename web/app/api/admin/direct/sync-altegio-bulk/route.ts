// web/app/api/admin/direct/sync-altegio-bulk/route.ts
// Масове завантаження клієнтів з Altegio в Direct Manager

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { altegioFetch } from '@/lib/altegio/client';
import { getEnvValue } from '@/lib/env';
import { normalizeInstagram } from '@/lib/normalize';

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
    const body = await req.json();
    const { location_id, max_clients, page_size = 100 } = body;

    // Визначаємо, чи це тестовий режим (якщо вказано max_clients)
    const isTestMode = !!max_clients && max_clients > 0;

    // Отримуємо location_id з body або з env
    const companyIdStr = location_id || getEnvValue('ALTEGIO_COMPANY_ID');
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

    console.log(`[direct/sync-altegio-bulk] Starting bulk sync from Altegio location_id=${companyId}, testMode=${isTestMode}`);

    // Отримуємо існуючих Direct клієнтів для перевірки дублікатів
    const existingDirectClients = await getAllDirectClients();
    const existingInstagramMap = new Map<string, string>(); // instagram -> clientId
    const existingAltegioIdMap = new Map<number, string>(); // altegioClientId -> clientId
    for (const client of existingDirectClients) {
      const normalized = normalizeInstagram(client.instagramUsername);
      if (normalized) {
        existingInstagramMap.set(normalized, client.id);
      }
      // Також індексуємо по altegioClientId для оновлення існуючих клієнтів
      if (client.altegioClientId) {
        existingAltegioIdMap.set(client.altegioClientId, client.id);
      }
    }

    let page = 1;
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkippedNoInstagram = 0;
    let totalSkippedDuplicate = 0;
    const syncedClientIds: string[] = [];

    // Завантажуємо клієнтів з Altegio з пагінацією
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
              // ВАЖЛИВО: Altegio API /clients/search НЕ повертає custom_fields, навіть якщо вказати їх в fields
              // Потрібно використовувати вебхуки або звернутися до підтримки Altegio
              // fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
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
          console.log(`[direct/sync-altegio-bulk] Sample client structure (first client):`, {
            id: clients[0].id,
            name: clients[0].name,
            allKeys: Object.keys(clients[0]),
            hasCustomFields: !!clients[0].custom_fields,
            customFieldsType: typeof clients[0].custom_fields,
            customFieldsIsArray: Array.isArray(clients[0].custom_fields),
            customFieldsPreview: clients[0].custom_fields ? JSON.stringify(clients[0].custom_fields).substring(0, 200) : null,
          });
        }

        // Обробляємо кожного клієнта
        for (const altegioClient of clients) {
          totalProcessed++;

          // Перевіряємо ліміт перед обробкою
          if (max_clients && totalProcessed > max_clients) {
            break;
          }

          // Детальне логування для проблемного клієнта
          if (altegioClient.id === 176404915) {
            console.log(`[direct/sync-altegio-bulk] DEBUG: Full client data for ${altegioClient.id}:`, {
              id: altegioClient.id,
              name: altegioClient.name,
              allKeys: Object.keys(altegioClient),
              custom_fields: altegioClient.custom_fields,
              custom_fields_type: typeof altegioClient.custom_fields,
              custom_fields_isArray: Array.isArray(altegioClient.custom_fields),
              fullClient: JSON.stringify(altegioClient, null, 2),
            });
          }

          // Витягуємо Instagram username
          let instagramUsername = extractInstagramFromAltegioClient(altegioClient);
          
          // ВАЖЛИВО: Altegio API /clients/search НЕ повертає custom_fields
          // Instagram username можна отримати тільки через вебхуки або звернувшись до підтримки Altegio
          if (!instagramUsername && altegioClient.id === 176404915) {
            console.log(`[direct/sync-altegio-bulk] ⚠️ WARNING: Instagram not found for client ${altegioClient.id}. Altegio API /clients/search does not return custom_fields.`);
            console.log(`[direct/sync-altegio-bulk] 💡 Solution: Use Altegio webhooks to get custom_fields when clients are updated, or contact Altegio support.`);
          }
          
          // У тестовому режимі дозволяємо збереження без Instagram username
          // Генеруємо унікальний username на основі ID або імені
          if (!instagramUsername && isTestMode) {
            const { firstName, lastName } = extractNameFromAltegioClient(altegioClient);
            const namePart = firstName || lastName || 'client';
            // Генеруємо унікальний username: altegio_{id} або altegio_{name}_{id}
            const nameSlug = (firstName || lastName || 'client')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .substring(0, 10);
            instagramUsername = `altegio_${nameSlug}_${altegioClient.id}`;
            console.log(`[direct/sync-altegio-bulk] Generated Instagram username for client ${altegioClient.id}: ${instagramUsername}`);
          }
          
          if (!instagramUsername) {
            totalSkippedNoInstagram++;
            continue;
          }

          // Перевіряємо на дублікати
          const normalizedInstagram = normalizeInstagram(instagramUsername);
          let existingClientId = existingInstagramMap.get(normalizedInstagram);
          let foundByInstagram = !!existingClientId;
          
          // Якщо не знайдено по Instagram, шукаємо по altegioClientId
          // (це важливо для клієнтів, які раніше були без Instagram username)
          if (!existingClientId && altegioClient.id) {
            existingClientId = existingAltegioIdMap.get(altegioClient.id);
          }
          
          // Якщо знайдено по Instagram, але altegioClientId не співпадає,
          // це може бути інший клієнт з таким же Instagram - перевіряємо
          if (foundByInstagram && existingClientId && altegioClient.id) {
            const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
            // Якщо знайдений клієнт має інший altegioClientId, шукаємо по altegioClientId
            if (existingClient && existingClient.altegioClientId && existingClient.altegioClientId !== altegioClient.id) {
              const clientByAltegioId = existingAltegioIdMap.get(altegioClient.id);
              if (clientByAltegioId) {
                // Знайдено клієнта по altegioClientId - використовуємо його
                existingClientId = clientByAltegioId;
                foundByInstagram = false;
              }
            }
          }

          // Витягуємо ім'я
          const { firstName, lastName } = extractNameFromAltegioClient(altegioClient);

          if (existingClientId) {
            // Оновлюємо існуючого клієнта
            const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
            if (existingClient) {
              // Перевіряємо, чи потрібно оновити Instagram username
              const existingNormalized = normalizeInstagram(existingClient.instagramUsername);
              const currentNormalized = normalizedInstagram;
              
              // Оновлюємо Instagram username якщо:
              // 1. Він змінився
              // 2. Або старий був згенерований (починається з "altegio_"), а новий - справжній
              // 3. Або клієнт знайдений по altegioClientId (не по Instagram) - тоді завжди оновлюємо
              const isOldGenerated = existingNormalized && existingNormalized.startsWith('altegio_');
              const isNewReal = currentNormalized && !currentNormalized.startsWith('altegio_');
              const shouldUpdateInstagram = 
                existingNormalized !== currentNormalized || 
                (isOldGenerated && isNewReal) ||
                !foundByInstagram; // Якщо знайдено по altegioClientId, завжди оновлюємо Instagram
              
              console.log(`[direct/sync-altegio-bulk] Updating client ${existingClientId}:`, {
                foundByInstagram,
                existingInstagram: existingClient.instagramUsername,
                newInstagram: instagramUsername,
                existingNormalized,
                currentNormalized,
                isOldGenerated,
                isNewReal,
                shouldUpdateInstagram,
                altegioClientId: altegioClient.id,
                existingAltegioClientId: existingClient.altegioClientId,
              });
              
              const updated: typeof existingClient = {
                ...existingClient,
                altegioClientId: altegioClient.id,
                // Оновлюємо Instagram username, якщо він змінився або був згенерований
                ...(shouldUpdateInstagram && { instagramUsername: normalizedInstagram }),
                ...(firstName && !existingClient.firstName && { firstName }),
                ...(lastName && !existingClient.lastName && { lastName }),
                updatedAt: new Date().toISOString(),
              };
              await saveDirectClient(updated);
              totalUpdated++;
              syncedClientIds.push(existingClientId);
              
              // Оновлюємо мапи для наступних ітерацій
              if (shouldUpdateInstagram) {
                existingInstagramMap.set(normalizedInstagram, existingClientId);
                // Видаляємо старий Instagram username з мапи, якщо він був згенерований
                if (existingNormalized && existingNormalized.startsWith('altegio_')) {
                  existingInstagramMap.delete(existingNormalized);
                }
              }
            } else {
              totalSkippedDuplicate++;
            }
          } else {
            // Створюємо нового клієнта
            const now = new Date().toISOString();
            const newClient = {
              id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              source: 'instagram' as const,
              firstContactDate: now,
              statusId: 'new',
              visitedSalon: false,
              signedUpForPaidService: false,
              altegioClientId: altegioClient.id,
              createdAt: now,
              updatedAt: now,
            };

            await saveDirectClient(newClient);
            totalCreated++;
            syncedClientIds.push(newClient.id);
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

    console.log(`[direct/sync-altegio-bulk] Sync completed:`, {
      totalProcessed,
      totalCreated,
      totalUpdated,
      totalSkippedNoInstagram,
      totalSkippedDuplicate,
      syncedClientIds: syncedClientIds.length,
    });

    return NextResponse.json({
      ok: true,
      stats: {
        totalProcessed,
        totalCreated,
        totalUpdated,
        totalSkippedNoInstagram,
        totalSkippedDuplicate,
        syncedClientIds: syncedClientIds.length,
      },
      message: `Синхронізовано: ${totalCreated} створено, ${totalUpdated} оновлено, ${totalSkippedNoInstagram} пропущено (немає Instagram)`,
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
