// web/app/api/admin/direct/sync-manychat-webhooks/route.ts
// Синхронізація старих вебхуків ManyChat з Direct клієнтами

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByInstagram, saveDirectClient, getAllDirectStatuses } from '@/lib/direct-store';
import { normalizeInstagram } from '@/lib/normalize';
import { kvRead } from '@/lib/kv';
import type { DirectClient } from '@/lib/direct-types';

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
 * Витягує Instagram username та fullName з rawBody вебхука
 */
function extractDataFromRawBody(rawBody: string): { username: string | null; fullName: string | null; text: string | null } {
  try {
    // rawBody може бути JSON рядком з екрануванням
    const parsed = JSON.parse(rawBody);
    
    const username = 
      parsed.username || 
      parsed.handle || 
      parsed.user_name || 
      parsed.instagram_username ||
      null;
    
    const fullName = 
      parsed.full_name || 
      parsed.fullName || 
      parsed.fullname || 
      parsed.name ||
      (parsed.first_name && parsed.last_name ? `${parsed.first_name} ${parsed.last_name}` : null) ||
      null;
    
    const text = 
      parsed.text || 
      parsed.message || 
      parsed.last_input_text || 
      parsed.input ||
      null;
    
    return { username, fullName, text };
  } catch {
    // Якщо не вдалося розпарсити, спробуємо знайти в рядку
    try {
      // Спробуємо знайти username в рядку
      const usernameMatch = rawBody.match(/"username"\s*:\s*"([^"]+)"/);
      const fullNameMatch = rawBody.match(/"full_name"\s*:\s*"([^"]+)"/);
      const textMatch = rawBody.match(/"text"\s*:\s*"([^"]+)"/);
      
      return {
        username: usernameMatch ? usernameMatch[1] : null,
        fullName: fullNameMatch ? fullNameMatch[1] : null,
        text: textMatch ? textMatch[1] : null,
      };
    } catch {
      return { username: null, fullName: null, text: null };
    }
  }
}

/**
 * POST - синхронізувати всі старі вебхуки ManyChat з Direct клієнтами
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit = body.limit || 100; // За замовчуванням обробляємо 100 вебхуків
    const days = body.days !== undefined ? body.days : null; // null = синхронізувати всі вебхуки
    const skipDaysFilter = body.skipDaysFilter === true; // Опція пропустити фільтр по днях

    console.log(`[direct/sync-manychat-webhooks] Starting sync, limit: ${limit}, days: ${days}, skipDaysFilter: ${skipDaysFilter}`);

    // Отримуємо всі вебхуки з логу
    // Читаємо більше елементів, щоб перевірити, скільки насправді є в логу
    const checkLimit = Math.max(limit, 1000); // Читаємо більше, щоб перевірити загальну кількість
    const allRawItems = await kvRead.lrange('manychat:webhook:log', 0, checkLimit - 1);
    const totalInLog = allRawItems.length;
    
    // Беремо тільки потрібну кількість
    const rawItems = allRawItems.slice(0, limit);
    
    console.log(`[direct/sync-manychat-webhooks] Found ${rawItems.length} raw items (requested limit: ${limit}, total in log: ${totalInLog})`);
    
    if (rawItems.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No webhooks found in log',
        results: {
          processed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          errorsList: [],
        },
        diagnostics: {
          rawItemsCount: 0,
          message: 'No webhooks in manychat:webhook:log. Webhooks might not be logged yet or log was cleared.',
        },
      });
    }

    // Парсимо вебхуки
    let parsedCount = 0;
    let hasReceivedAtCount = 0;
    let filteredByDaysCount = 0;
    const webhooks = rawItems
      .map((raw, index) => {
        try {
          let parsed: unknown = raw;
          
          if (typeof raw === 'string') {
            try {
              parsed = JSON.parse(raw);
            } catch {
              return null;
            }
          } else if (raw && typeof raw === 'object') {
            const rawObj = raw as Record<string, unknown>;
            if ('value' in rawObj && typeof rawObj.value === 'string') {
              try {
                parsed = JSON.parse(rawObj.value);
              } catch {
                parsed = rawObj.value;
              }
            } else {
              parsed = raw;
            }
          }
          
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedCount++;
            const parsedObj = parsed as Record<string, unknown>;
            
            // Якщо parsed має тільки поле "value", спробуємо розпарсити його ще раз
            const parsedKeys = Object.keys(parsedObj);
            if (parsedKeys.length === 1 && parsedKeys[0] === 'value' && typeof parsedObj.value === 'string') {
              try {
                const doubleParsed = JSON.parse(parsedObj.value);
                if (doubleParsed && typeof doubleParsed === 'object' && !Array.isArray(doubleParsed)) {
                  const doubleParsedObj = doubleParsed as Record<string, unknown>;
                  if ('receivedAt' in doubleParsedObj) {
                    hasReceivedAtCount++;
                    // Якщо skipDaysFilter = true або days = null, не фільтруємо по днях
                    if (skipDaysFilter || days === null) {
                      return doubleParsedObj;
                    }
                    
                    // Перевіряємо, чи вебхук в межах вказаних днів
                    const receivedAt = new Date(doubleParsedObj.receivedAt as string);
                    const daysAgo = new Date();
                    daysAgo.setDate(daysAgo.getDate() - days);
                    
                    if (receivedAt >= daysAgo) {
                      return doubleParsedObj;
                    } else {
                      filteredByDaysCount++;
                    }
                  }
                }
              } catch {
                // Якщо не вдалося розпарсити, продовжуємо з поточним parsedObj
              }
            }
            
            if ('receivedAt' in parsedObj) {
              hasReceivedAtCount++;
              // Якщо skipDaysFilter = true або days = null, не фільтруємо по днях
              if (skipDaysFilter || days === null) {
                return parsedObj;
              }
              
              // Перевіряємо, чи вебхук в межах вказаних днів
              const receivedAt = new Date(parsedObj.receivedAt as string);
              const daysAgo = new Date();
              daysAgo.setDate(daysAgo.getDate() - days);
              
              if (receivedAt >= daysAgo) {
                return parsedObj;
              } else {
                filteredByDaysCount++;
              }
            }
          }
          
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    console.log(`[direct/sync-manychat-webhooks] Parsing stats:`, {
      rawItems: rawItems.length,
      parsed: parsedCount,
      hasReceivedAt: hasReceivedAtCount,
      filteredByDays: filteredByDaysCount,
      finalWebhooks: webhooks.length,
    });
    
    console.log(`[direct/sync-manychat-webhooks] Found ${webhooks.length} webhooks${days !== null ? ` within last ${days} days` : ' (all webhooks)'}`);
    
    // Додаткова діагностика: показуємо дати вебхуків
    if (webhooks.length === 0 && rawItems.length > 0) {
      const sampleDates = rawItems.slice(0, 5).map((raw) => {
        try {
          let parsed: unknown = raw;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else if (raw && typeof raw === 'object') {
            const rawObj = raw as Record<string, unknown>;
            if ('value' in rawObj && typeof rawObj.value === 'string') {
              parsed = JSON.parse(rawObj.value);
            }
          }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const parsedObj = parsed as Record<string, unknown>;
            return {
              receivedAt: parsedObj.receivedAt as string,
              hasRawBody: !!parsedObj.rawBody,
              keys: Object.keys(parsedObj),
            };
          }
        } catch {
          return null;
        }
        return null;
      }).filter(Boolean);
      
      console.log(`[direct/sync-manychat-webhooks] Sample webhook data:`, sampleDates);
      
      return NextResponse.json({
        ok: true,
        message: `Found ${rawItems.length} raw items but 0 webhooks passed filters`,
        results: {
          processed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          errorsList: [],
        },
        diagnostics: {
          rawItemsCount: rawItems.length,
          parsedCount,
          hasReceivedAtCount,
          filteredByDaysCount,
          daysFilter: days,
          skipDaysFilter,
          sampleWebhooks: sampleDates,
        },
      });
    }

    // Імпортуємо функції для роботи з Direct Manager
    const statuses = await getAllDirectStatuses();
    const defaultStatus = statuses.find((s) => s.isDefault) || statuses[0];

    // Автоматично призначаємо дірект-менеджера для клієнтів з ManyChat
    let masterId: string | undefined = undefined;
    try {
      const { getDirectManager } = await import('@/lib/direct-masters/store');
      const directManager = await getDirectManager();
      if (directManager) {
        masterId = directManager.id;
        console.log(`[direct/sync-manychat-webhooks] Auto-assigning direct manager: ${directManager.name} (${directManager.id})`);
      }
    } catch (err) {
      console.warn('[direct/sync-manychat-webhooks] Failed to get direct manager:', err);
    }

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      errorsList: [] as Array<{ webhook: string; error: string }>,
    };

    // Статистика для діагностики
    const diagnostics = {
      noRawBody: 0,
      noUsername: 0,
      invalidInstagram: 0,
      sampleSkipped: [] as Array<{ reason: string; rawBodyPreview?: string }>,
    };

    // Обробляємо кожен вебхук
    for (const webhook of webhooks) {
      try {
        const rawBody = webhook.rawBody as string | undefined;
        if (!rawBody) {
          results.skipped++;
          diagnostics.noRawBody++;
          if (diagnostics.sampleSkipped.length < 3) {
            diagnostics.sampleSkipped.push({ 
              reason: 'no rawBody',
              rawBodyPreview: 'missing',
            });
          }
          continue;
        }

        // Витягуємо дані з rawBody
        const { username, fullName, text } = extractDataFromRawBody(rawBody);
        
        if (!username) {
          results.skipped++;
          diagnostics.noUsername++;
          if (diagnostics.sampleSkipped.length < 3) {
            diagnostics.sampleSkipped.push({ 
              reason: 'no username in rawBody',
              rawBodyPreview: rawBody.substring(0, 200),
            });
          }
          continue;
        }

        // Нормалізуємо Instagram username
        const normalizedInstagram = normalizeInstagram(username);
        if (!normalizedInstagram) {
          results.skipped++;
          diagnostics.invalidInstagram++;
          if (diagnostics.sampleSkipped.length < 3) {
            diagnostics.sampleSkipped.push({ 
              reason: `invalid Instagram format: ${username}`,
              rawBodyPreview: rawBody.substring(0, 200),
            });
          }
          continue;
        }

        // Перевіряємо, чи існує клієнт
        let client = await getDirectClientByInstagram(normalizedInstagram);
        const wasCreated = !client;

        const fullNameParts = fullName ? fullName.trim().split(' ') : [];
        const firstName = fullNameParts[0] || undefined;
        const lastName = fullNameParts.slice(1).join(' ') || undefined;

        if (!client) {
          // Створюємо нового клієнта
          const receivedAt = webhook.receivedAt as string;
          const firstContactDate = receivedAt || new Date().toISOString();
          
          client = {
            id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            source: 'instagram',
            // Стан "Лід" більше не використовуємо: стартуємо з "Розмова"
            state: 'message' as const,
            firstContactDate,
            statusId: defaultStatus?.id || 'new',
            masterId,
            masterManuallySet: false,
            visitedSalon: false,
            signedUpForPaidService: false,
            lastMessageAt: receivedAt || new Date().toISOString(),
            createdAt: firstContactDate,
            updatedAt: firstContactDate,
          };
          
          results.created++;
        } else {
          // Оновлюємо існуючого клієнта
          const receivedAt = webhook.receivedAt as string;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-manychat-webhooks/route.ts:387',message:'Updating existing client from ManyChat',data:{clientId:client.id,hasAltegioClientId:!!client.altegioClientId,altegioClientId:client.altegioClientId,existingFirstName:client.firstName,existingLastName:client.lastName,manychatFirstName:firstName,manychatLastName:lastName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // ВАЖЛИВО: Якщо клієнт має altegioClientId, не перезаписуємо ім'я з ManyChat
          // Пріоритет має ім'я з Altegio
          const shouldUpdateName = !client.altegioClientId; // Оновлюємо ім'я тільки якщо немає altegioClientId
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-manychat-webhooks/route.ts:395',message:'Name update decision',data:{shouldUpdateName,hasAltegioClientId:!!client.altegioClientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // Новий лід = сьогодні вперше написав. Якщо отримали старіше повідомлення — оновлюємо firstContactDate.
          const receivedAtDate = receivedAt ? new Date(receivedAt) : null;
          const existingFirst = client.firstContactDate ? new Date(client.firstContactDate) : null;
          const shouldBackdateFirstContact = receivedAtDate && existingFirst && receivedAtDate < existingFirst;

          client = {
            ...client,
            instagramUsername: normalizedInstagram,
            ...(shouldUpdateName && firstName && { firstName }),
            ...(shouldUpdateName && lastName && { lastName }),
            ...(shouldBackdateFirstContact && receivedAt && { firstContactDate: receivedAt }),
            lastMessageAt: receivedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-manychat-webhooks/route.ts:405',message:'Client after update',data:{clientId:client.id,firstName:client.firstName,lastName:client.lastName,hasAltegioClientId:!!client.altegioClientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          results.updated++;
        }

        // Зберігаємо клієнта
        await saveDirectClient(client, 'manychat-webhook-sync', {
          webhookReceivedAt: webhook.receivedAt as string,
          fullName,
          text,
        }, { touchUpdatedAt: false });

        results.processed++;
      } catch (error) {
        results.errors++;
        results.errorsList.push({
          webhook: JSON.stringify(webhook).substring(0, 200),
          error: error instanceof Error ? error.message : String(error),
        });
        console.error('[direct/sync-manychat-webhooks] Error processing webhook:', error);
      }
    }

    console.log(`[direct/sync-manychat-webhooks] Sync completed:`, results);
    console.log(`[direct/sync-manychat-webhooks] Diagnostics:`, diagnostics);

    return NextResponse.json({
      ok: true,
      message: `Processed ${results.processed} webhooks from ${webhooks.length} total`,
      results,
      diagnostics: {
        totalInLog: totalInLog,
        requestedLimit: limit,
        rawItemsRead: rawItems.length,
        totalWebhooks: webhooks.length,
        skippedReasons: {
          noRawBody: diagnostics.noRawBody,
          noUsername: diagnostics.noUsername,
          invalidInstagram: diagnostics.invalidInstagram,
        },
        sampleSkipped: diagnostics.sampleSkipped,
      },
    });
  } catch (error) {
    console.error('[direct/sync-manychat-webhooks] POST error:', error);
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
 * GET - інформація про вебхуки та можливість синхронізації
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    // Отримуємо вебхуки
    const rawItems = await kvRead.lrange('manychat:webhook:log', 0, limit - 1);
    
    const webhooks = rawItems
      .map((raw) => {
        try {
          let parsed: unknown = raw;
          
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else if (raw && typeof raw === 'object') {
            const rawObj = raw as Record<string, unknown>;
            if ('value' in rawObj && typeof rawObj.value === 'string') {
              parsed = JSON.parse(rawObj.value);
            } else {
              parsed = raw;
            }
          }
          
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const parsedObj = parsed as Record<string, unknown>;
            if ('receivedAt' in parsedObj) {
              return {
                receivedAt: parsedObj.receivedAt,
                hasRawBody: !!parsedObj.rawBody,
                bodyLength: parsedObj.bodyLength,
              };
            }
          }
          
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Групуємо по днях
    const byDay: Record<string, number> = {};
    webhooks.forEach((w: any) => {
      if (w.receivedAt) {
        const date = new Date(w.receivedAt).toISOString().split('T')[0];
        byDay[date] = (byDay[date] || 0) + 1;
      }
    });

    return NextResponse.json({
      ok: true,
      totalWebhooks: webhooks.length,
      byDay,
      webhooks: webhooks.slice(0, 10), // Перші 10 для прикладу
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
