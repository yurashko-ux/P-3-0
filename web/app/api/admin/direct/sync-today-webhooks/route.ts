// web/app/api/admin/direct/sync-today-webhooks/route.ts
// Обробка сьогоднішніх вебхуків від Altegio для синхронізації клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

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
 * POST - обробити сьогоднішні вебхуки від Altegio
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо сьогоднішню дату (початок дня)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    console.log(`[direct/sync-today-webhooks] Processing webhooks from ${todayISO}`);

    // Отримуємо всі вебхуки з логу
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const events = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Фільтруємо вебхуки за сьогоднішню дату та ті, що стосуються клієнтів або записів
    const todayEvents = events.filter((e: any) => {
      if (!e.receivedAt) return false;
      const receivedDate = new Date(e.receivedAt);
      receivedDate.setHours(0, 0, 0, 0);
      const isToday = receivedDate.getTime() === today.getTime();
      const isClientEvent = e.body?.resource === 'client' && (e.body?.status === 'create' || e.body?.status === 'update');
      const isRecordEvent = e.body?.resource === 'record' && (e.body?.status === 'create' || e.body?.status === 'update');
      return isToday && (isClientEvent || isRecordEvent);
    });

    console.log(`[direct/sync-today-webhooks] Found ${todayEvents.length} events from today (client + record)`);

    // Імпортуємо функції для обробки вебхуків
    const { getAllDirectClients, getAllDirectStatuses, saveDirectClient } = await import('@/lib/direct-store');
    const { normalizeInstagram } = await import('@/lib/normalize');

    // Отримуємо існуючих клієнтів
    const existingDirectClients = await getAllDirectClients();
    const existingInstagramMap = new Map<string, string>();
    const existingAltegioIdMap = new Map<number, string>();
    
    for (const dc of existingDirectClients) {
      const normalized = normalizeInstagram(dc.instagramUsername);
      if (normalized) {
        existingInstagramMap.set(normalized, dc.id);
      }
      if (dc.altegioClientId) {
        existingAltegioIdMap.set(dc.altegioClientId, dc.id);
      }
    }

    // Отримуємо статус за замовчуванням
    const allStatuses = await getAllDirectStatuses();
    const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
    if (!defaultStatus) {
      return NextResponse.json({
        ok: false,
        error: 'No default status found',
      }, { status: 500 });
    }

    const results = {
      totalEvents: todayEvents.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Обробляємо кожен вебхук
    for (const event of todayEvents) {
      try {
        // Для record events клієнт знаходиться в data.client
        // Для client events клієнт знаходиться в data або data.client
        const isRecordEvent = event.body?.resource === 'record';
        const clientId = isRecordEvent 
          ? (event.body?.data?.client?.id || event.body?.data?.client_id)
          : event.body?.resource_id;
        const client = isRecordEvent
          ? event.body?.data?.client
          : (event.body?.data?.client || event.body?.data);
        const status = event.body?.status;

        if (!clientId || !client) {
          results.skipped++;
          continue;
        }

        // Витягуємо Instagram username (використовуємо ту саму логіку, що й в webhook route)
        let instagram: string | null = null;
        
        if (client.custom_fields) {
          if (Array.isArray(client.custom_fields)) {
            for (const field of client.custom_fields) {
              if (field && typeof field === 'object') {
                const title = field.title || field.name || field.label || '';
                const value = field.value || field.data || field.content || field.text || '';
                if (value && typeof value === 'string' && /instagram/i.test(title)) {
                  instagram = value.trim();
                  break;
                }
              }
            }
          } else if (typeof client.custom_fields === 'object') {
            for (const [key, value] of Object.entries(client.custom_fields)) {
              if (value && typeof value === 'string' && /instagram/i.test(key)) {
                instagram = value.trim();
                break;
              }
            }
          }
        }

        // Перевіряємо, чи Instagram валідний (не "no", не порожній, не null)
        const invalidValues = ['no', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
        if (instagram) {
          const lowerInstagram = instagram.toLowerCase().trim();
          if (invalidValues.includes(lowerInstagram)) {
            instagram = null; // Вважаємо Instagram відсутнім
          }
        }

        // Якщо немає Instagram, перевіряємо збережений зв'язок
        let normalizedInstagram: string | null = null;
        let isMissingInstagram = false;

        const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
        const existingClientByAltegioId = await getDirectClientByAltegioId(parseInt(String(clientId), 10));
        
        if (existingClientByAltegioId) {
          // Якщо клієнт існує, але в webhook є новий Instagram - використовуємо його (пріоритет webhook'у)
          if (instagram) {
            const normalizedFromWebhook = normalizeInstagram(instagram);
            if (normalizedFromWebhook) {
              normalizedInstagram = normalizedFromWebhook;
              isMissingInstagram = false;
              console.log(`[sync-today-webhooks] ✅ Found Instagram in webhook for existing client ${clientId}: ${normalizedInstagram} (updating from ${existingClientByAltegioId.instagramUsername})`);
            } else {
              // Якщо Instagram з webhook'а невалідний, використовуємо старий
              normalizedInstagram = existingClientByAltegioId.instagramUsername;
              isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_');
            }
          } else {
            // Якщо в webhook немає Instagram, використовуємо існуючий
            normalizedInstagram = existingClientByAltegioId.instagramUsername;
            isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_');
          }
        } else {
          // Клієнта не знайдено - обробляємо Instagram з вебхука
          if (!instagram) {
            isMissingInstagram = true;
            normalizedInstagram = `missing_instagram_${clientId}`;
          } else {
            normalizedInstagram = normalizeInstagram(instagram);
            if (!normalizedInstagram) {
              isMissingInstagram = true;
              normalizedInstagram = `missing_instagram_${clientId}`;
            } else {
              isMissingInstagram = false;
            }
          }
        }

        // Витягуємо ім'я
        const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        // Шукаємо існуючого клієнта
        let existingClientIdByInstagram = normalizedInstagram && !normalizedInstagram.startsWith('missing_instagram_')
          ? existingInstagramMap.get(normalizedInstagram)
          : null;
        let existingClientIdByAltegio = clientId
          ? existingAltegioIdMap.get(parseInt(String(clientId), 10))
          : null;
        
        // Визначаємо, який клієнт залишити при об'єднанні
        // Пріоритет: клієнт з правильним Instagram, а не з missing_instagram_*
        let existingClientId: string | null = null;
        let duplicateClientId: string | null = null;
        
        if (existingClientIdByInstagram && existingClientIdByAltegio) {
          if (existingClientIdByInstagram === existingClientIdByAltegio) {
            // Це той самий клієнт - просто оновлюємо
            existingClientId = existingClientIdByInstagram;
          } else {
            // Різні клієнти - потрібно об'єднати
            const clientByInstagram = existingDirectClients.find((c) => c.id === existingClientIdByInstagram);
            const clientByAltegio = existingDirectClients.find((c) => c.id === existingClientIdByAltegio);
            
            // Перевіряємо, який має missing_instagram_*
            const instagramHasMissing = clientByInstagram?.instagramUsername?.startsWith('missing_instagram_');
            const altegioHasMissing = clientByAltegio?.instagramUsername?.startsWith('missing_instagram_');
            
            if (instagramHasMissing && !altegioHasMissing) {
              // Клієнт по Instagram має missing_instagram_*, клієнт по Altegio ID має правильний Instagram
              // Залишаємо клієнта по Altegio ID (з правильним Instagram)
              existingClientId = existingClientIdByAltegio;
              duplicateClientId = existingClientIdByInstagram;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (has real Instagram), deleting ${duplicateClientId} (has missing_instagram_*)`);
            } else if (!instagramHasMissing && altegioHasMissing) {
              // Клієнт по Altegio ID має missing_instagram_*, клієнт по Instagram має правильний Instagram
              // Залишаємо клієнта по Instagram (з правильним Instagram)
              existingClientId = existingClientIdByInstagram;
              duplicateClientId = existingClientIdByAltegio;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (has real Instagram), deleting ${duplicateClientId} (has missing_instagram_*)`);
            } else {
              // Обидва мають або не мають missing_instagram_* - залишаємо клієнта по Instagram (новіший)
              existingClientId = existingClientIdByInstagram;
              duplicateClientId = existingClientIdByAltegio;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (by Instagram), deleting ${duplicateClientId} (by Altegio ID)`);
            }
          }
        } else if (existingClientIdByInstagram) {
          existingClientId = existingClientIdByInstagram;
        } else if (existingClientIdByAltegio) {
          existingClientId = existingClientIdByAltegio;
        }

        if (existingClientId) {
          // Оновлюємо існуючого клієнта
          const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
          if (existingClient) {
            // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
            const clientState = 'client' as const;
            const updated = {
              ...existingClient,
              altegioClientId: parseInt(String(clientId), 10),
              instagramUsername: normalizedInstagram,
              state: clientState,
              ...(firstName && { firstName }),
              ...(lastName && { lastName }),
              updatedAt: new Date().toISOString(),
            };
            await saveDirectClient(updated);
            results.updated++;
            results.clients.push({
              id: updated.id,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              altegioClientId: clientId,
              action: 'updated',
              state: clientState,
            });
            
            // Якщо знайдено дублікат, перевіряємо, чи можна його видалити
            if (duplicateClientId) {
              try {
                const duplicateClient = existingDirectClients.find((c) => c.id === duplicateClientId);
                if (duplicateClient) {
                  // Перевіряємо, чи є у дубліката записи (state logs, дати візитів тощо)
                  const { getStateHistory } = await import('@/lib/direct-state-log');
                  const duplicateHistory = await getStateHistory(duplicateClientId);
                  const hasRecords = 
                    duplicateHistory.length > 1 || // Є записи в історії (більше ніж поточний стан)
                    duplicateClient.paidServiceDate ||
                    duplicateClient.consultationBookingDate ||
                    duplicateClient.consultationDate ||
                    duplicateClient.visitDate ||
                    duplicateClient.lastMessageAt;
                  
                  if (hasRecords) {
                    // У дубліката є записи - не видаляємо, а оновлюємо його замість основного клієнта
                    console.log(`[sync-today-webhooks] ⚠️ Duplicate client ${duplicateClientId} has records, keeping it instead of ${existingClientId}`);
                    
                    // Видаляємо "основного" клієнта і залишаємо дубліката
                    const { deleteDirectClient } = await import('@/lib/direct-store');
                    await deleteDirectClient(existingClientId);
                    console.log(`[sync-today-webhooks] ✅ Deleted client ${existingClientId} (no records), kept ${duplicateClientId} (has records)`);
                    
                    // Оновлюємо дубліката з новими даними
                    const clientState = 'client' as const;
                    const updatedDuplicate = {
                      ...duplicateClient,
                      altegioClientId: parseInt(String(clientId), 10),
                      instagramUsername: normalizedInstagram,
                      state: clientState,
                      ...(firstName && { firstName }),
                      ...(lastName && { lastName }),
                      updatedAt: new Date().toISOString(),
                    };
                    const { saveDirectClient } = await import('@/lib/direct-store');
                    await saveDirectClient(updatedDuplicate);
                    
                    // Оновлюємо results - замінюємо updated на правильний ID
                    results.clients = results.clients.filter((c: any) => c.id !== existingClientId);
                    results.clients.push({
                      id: updatedDuplicate.id,
                      instagramUsername: normalizedInstagram,
                      firstName,
                      lastName,
                      altegioClientId: clientId,
                      action: 'updated',
                      state: clientState,
                    });
                    results.clients.push({
                      id: existingClientId,
                      instagramUsername: 'DELETED_NO_RECORDS',
                      action: 'deleted',
                      state: 'deleted',
                    });
                  } else {
                    // У дубліката немає записів - можна видалити
                    const { deleteDirectClient } = await import('@/lib/direct-store');
                    await deleteDirectClient(duplicateClientId);
                    console.log(`[sync-today-webhooks] ✅ Deleted duplicate client ${duplicateClientId} (no records)`);
                    results.clients.push({
                      id: duplicateClientId,
                      instagramUsername: 'DELETED_DUPLICATE',
                      action: 'deleted',
                      state: 'deleted',
                    });
                  }
                }
              } catch (deleteErr) {
                console.error(`[sync-today-webhooks] ❌ Failed to process duplicate client ${duplicateClientId}:`, deleteErr);
                results.errors.push(`Failed to process duplicate client ${duplicateClientId}: ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`);
              }
            }
          }
        } else {
          // Створюємо нового клієнта
          const now = new Date().toISOString();
          // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
          const clientState = 'client' as const;
          const newClient = {
            id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            source: 'instagram' as const,
            state: clientState,
            firstContactDate: now,
            statusId: defaultStatus.id,
            visitedSalon: false,
            signedUpForPaidService: false,
            altegioClientId: parseInt(String(clientId), 10),
            createdAt: now,
            updatedAt: now,
          };
          await saveDirectClient(newClient);
          results.created++;
          results.clients.push({
            id: newClient.id,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            altegioClientId: clientId,
            action: 'created',
            state: clientState,
          });
        }

        results.processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(errorMsg);
        console.error(`[direct/sync-today-webhooks] Error processing event:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      date: todayISO,
      ...results,
    });
  } catch (error) {
    console.error('[direct/sync-today-webhooks] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET - отримати інформацію про сьогоднішні вебхуки (без обробки)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const events = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const todayClientEvents = events
      .filter((e: any) => {
        if (!e.receivedAt) return false;
        const receivedDate = new Date(e.receivedAt);
        receivedDate.setHours(0, 0, 0, 0);
        return receivedDate.getTime() === today.getTime();
      })
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        event: e.event || e.body?.event,
        resource: e.body?.resource,
        status: e.body?.status,
        resourceId: e.body?.resource_id,
        clientName: e.body?.data?.client?.name || e.body?.data?.client?.display_name || e.body?.data?.name,
        clientId: e.body?.data?.client?.id || e.body?.data?.id,
      }));

    return NextResponse.json({
      ok: true,
      date: today.toISOString(),
      totalEvents: todayClientEvents.length,
      events: todayClientEvents,
    });
  } catch (error) {
    console.error('[direct/sync-today-webhooks] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

