// web/app/api/admin/direct/sync-keycrm/route.ts
// Синхронізація клієнтів з KeyCRM в розділ Direct

import { NextRequest, NextResponse } from 'next/server';
import { resolveKeycrmBaseUrl, resolveKeycrmBearer, resolveKeycrmToken } from '@/lib/env';
import { getDirectClientByInstagram, getAllDirectStatuses, saveDirectClient } from '@/lib/direct-store';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';
import type { DirectClient } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Pro: до 60с. Синхронізація багатьох клієнтів з KeyCRM.

const BASE = resolveKeycrmBaseUrl().replace(/\/+$/, '');

function buildAuth(): string {
  const explicit = resolveKeycrmBearer();
  if (explicit) return explicit;
  const token = resolveKeycrmToken();
  return token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
}

const AUTH = buildAuth();

function headers() {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (AUTH) h.Authorization = AUTH;
  return h;
}

async function kcGet(path: string): Promise<{ ok: boolean; status: number; json: any }> {
  if (!AUTH) {
    return { ok: false, status: 401, json: { error: 'KeyCRM not configured' } };
  }
  
  try {
    const url = `${BASE}${path}`;
    const res = await fetch(url, { headers: headers(), cache: 'no-store' });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 500, json: { error: err instanceof Error ? err.message : String(err) } };
  }
}

// Нормалізація Instagram username
function normalizeInstagram(username: string | null | undefined): string | null {
  if (!username) return null;
  let normalized = username.trim().toLowerCase();
  normalized = normalized.replace(/^@+/, ''); // Прибираємо @
  normalized = normalized.replace(/^https?:\/\//, ''); // Прибираємо протокол
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.replace(/^instagram\.com\//, '');
  normalized = normalized.split('/')[0]; // Беремо тільки username
  normalized = normalized.split('?')[0]; // Прибираємо query параметри
  normalized = normalized.split('#')[0]; // Прибираємо hash
  return normalized || null;
}

// Витягування Instagram username з картки KeyCRM
function extractInstagramFromCard(card: any): string | null {
  console.log(`[direct/sync-keycrm] Extracting Instagram from card ${card?.id}, title: "${card?.title}"`);
  
  // 1. Custom fields (найбільш ймовірне місце для Instagram)
  if (card?.custom_fields && Array.isArray(card.custom_fields)) {
    for (const field of card.custom_fields) {
      if (field?.name && /instagram/i.test(field.name)) {
        const normalized = normalizeInstagram(field.value);
        if (normalized) {
          console.log(`[direct/sync-keycrm] Found Instagram in custom_fields: ${normalized}`);
          return normalized;
        }
      }
      if (field?.uuid && /instagram/i.test(field.uuid)) {
        const normalized = normalizeInstagram(field.value);
        if (normalized) {
          console.log(`[direct/sync-keycrm] Found Instagram in custom_fields (by uuid): ${normalized}`);
          return normalized;
        }
      }
    }
  }
  
  // 2. Contact custom fields
  if (card?.contact?.custom_fields && Array.isArray(card.contact.custom_fields)) {
    for (const field of card.contact.custom_fields) {
      if (field?.name && /instagram/i.test(field.name)) {
        const normalized = normalizeInstagram(field.value);
        if (normalized) {
          console.log(`[direct/sync-keycrm] Found Instagram in contact.custom_fields: ${normalized}`);
          return normalized;
        }
      }
    }
  }
  
  // 3. Client custom fields
  if (card?.contact?.client?.custom_fields && Array.isArray(card.contact.client.custom_fields)) {
    for (const field of card.contact.client.custom_fields) {
      if (field?.name && /instagram/i.test(field.name)) {
        const normalized = normalizeInstagram(field.value);
        if (normalized) {
          console.log(`[direct/sync-keycrm] Found Instagram in contact.client.custom_fields: ${normalized}`);
          return normalized;
        }
      }
    }
  }
  
  // 4. Social ID (перевіряємо чи це Instagram, а не Telegram/інше)
  const socialId = card?.contact?.social_id || card?.contact?.client?.social_id;
  if (socialId) {
    const socialName = card?.contact?.social_name || '';
    // Якщо social_name містить "instagram" або social_id виглядає як Instagram username
    if (/instagram/i.test(socialName) || (!/telegram|facebook|vk|whatsapp/i.test(socialName) && /^@?[a-z0-9._]+$/i.test(String(socialId).replace(/^@+/, '')))) {
      const normalized = normalizeInstagram(socialId);
      if (normalized) {
        console.log(`[direct/sync-keycrm] Found Instagram in social_id: ${normalized}`);
        return normalized;
      }
    }
  }
  
  // 5. Прямі поля
  const candidates = [
    card?.contact?.instagram,
    card?.contact?.client?.instagram,
    card?.instagram,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeInstagram(candidate);
    if (normalized) {
      console.log(`[direct/sync-keycrm] Found Instagram in direct field: ${normalized}`);
      return normalized;
    }
  }
  
  // 6. Спробуємо витягти з title (наприклад, "Чат з juliagricina" → "juliagricina")
  if (card?.title) {
    const titleMatch = card.title.match(/чат\s+з\s+([a-z0-9._]+)/i);
    if (titleMatch && titleMatch[1]) {
      const normalized = normalizeInstagram(titleMatch[1]);
      if (normalized && normalized.length > 0) {
        console.log(`[direct/sync-keycrm] Extracted Instagram from title: ${normalized}`);
        return normalized;
      }
    }
  }

  console.log(`[direct/sync-keycrm] No Instagram found for card ${card?.id}`);
  return null;
}

// Витягування імені з картки
function extractNameFromCard(card: any): { firstName?: string; lastName?: string; fullName?: string } {
  const contact = card?.contact;
  const client = card?.contact?.client;
  
  // Спробуємо витягти ім'я з різних джерел
  const fullName = 
    contact?.full_name || 
    contact?.name || 
    client?.full_name ||
    client?.name ||
    card?.title?.replace(/^Чат\s+з\s+/i, '') || // "Чат з Тетяна Бойко" → "Тетяна Бойко"
    null;
  
  if (fullName) {
    const parts = fullName.trim().split(' ').filter(p => p.length > 0);
    return {
      fullName,
      firstName: parts[0] || undefined,
      lastName: parts.slice(1).join(' ') || undefined,
    };
  }

  return {
    firstName: contact?.first_name || client?.first_name || undefined,
    lastName: contact?.last_name || client?.last_name || undefined,
  };
}

/**
 * POST /api/admin/direct/sync-keycrm
 * Синхронізує картки з KeyCRM в розділ Direct
 * 
 * Параметри:
 * - pipeline_id (опціонально) - фільтр за pipeline
 * - status_id (опціонально) - фільтр за status
 * - per_page (опціонально, default: 50) - кількість карток на сторінку
 * - max_pages (опціонально, default: 5) - максимальна кількість сторінок
 */
export async function POST(req: NextRequest) {
  try {
    // Перевірка авторизації
    const adminToken = req.cookies.get('admin_token')?.value;
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    const isAuthorized = 
      adminToken === process.env.ADMIN_PASS ||
      (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
      !process.env.ADMIN_PASS;

    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!AUTH || !BASE) {
      return NextResponse.json({ ok: false, error: 'KeyCRM not configured' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const pipelineId = body.pipeline_id || body.pipelineId;
    const statusId = body.status_id || body.statusId;
    const perPage = Math.min(Math.max(body.per_page || body.perPage || 50, 1), 100);
    
    // Для тесту: якщо вказано max_clients, обмежуємо кількість клієнтів
    const maxClients = body.max_clients || body.maxClients;
    let maxPages: number;
    
    if (maxClients && typeof maxClients === 'number' && maxClients > 0) {
      // Якщо вказано max_clients, обчислюємо скільки сторінок потрібно
      maxPages = Math.ceil(maxClients / perPage);
      console.log(`[direct/sync-keycrm] Test mode: limiting to ${maxClients} clients (${maxPages} pages)`);
    } else if (body.max_pages === 0 || body.maxPages === 0) {
      // Якщо max_pages = 0, синхронізуємо всіх (до 100 сторінок для безпеки)
      maxPages = 100;
      console.log(`[direct/sync-keycrm] Full sync mode: up to 100 pages`);
    } else {
      // За замовчуванням 10 сторінок
      maxPages = Math.min(Math.max(body.max_pages || body.maxPages || 10, 1), 100);
    }

    console.log('[direct/sync-keycrm] Starting sync:', {
      pipelineId,
      statusId,
      perPage,
      maxPages,
    });

    const statuses = await getAllDirectStatuses();
    const defaultStatus = statuses.find((s) => s.isDefault) || statuses[0];

    let page = 1;
    let totalCards = 0;
    let syncedClients = 0;
    let skippedNoInstagram = 0;
    let errors = 0;
    const allSyncedClientIds: string[] = []; // Зберігаємо всі ID для можливого перебудови індексу
    const maxClientsToSync = maxClients && typeof maxClients === 'number' ? maxClients : null;

    while (page <= maxPages) {
      // Формуємо URL для отримання карток
      let path = '/pipelines/cards';
      const params = new URLSearchParams();
      // KeyCRM використовує page та limit (не page[number] та page[size])
      params.set('page', String(page));
      params.set('limit', String(perPage));
      
      // Додаємо include для отримання контактів (важливо для Instagram username)
      // KeyCRM підтримує include як масив або окремі параметри
      params.append('include[]', 'contact');
      params.append('include[]', 'contact.client');
      params.append('include[]', 'status');
      params.append('include[]', 'custom_fields');

      if (pipelineId) {
        if (typeof pipelineId === 'number') {
          path = `/pipelines/${pipelineId}/cards`;
        } else {
          params.set('filter[pipeline_id]', String(pipelineId));
        }
      }

      if (statusId && typeof statusId === 'number') {
        params.set('filter[status_id]', String(statusId));
      }

      const fullPath = `${path}?${params.toString()}`;
      console.log(`[direct/sync-keycrm] Fetching page ${page}: ${fullPath}`);

      const response = await kcGet(fullPath);
      
      if (!response.ok) {
        console.error(`[direct/sync-keycrm] Failed to fetch cards:`, response.status, response.json);
        break;
      }

      const data = response.json;
      // KeyCRM повертає структуру: { data: [...], total, current_page, per_page, next_page_url }
      const cards = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      
      console.log(`[direct/sync-keycrm] Page ${page}: received ${cards.length} cards, total: ${data?.total || 'unknown'}`);
      console.log(`[direct/sync-keycrm] Sample card structure:`, cards[0] ? {
        id: cards[0].id,
        title: cards[0].title,
        hasContact: !!cards[0].contact,
        hasContactClient: !!cards[0].contact?.client,
        contactId: cards[0].contact_id,
      } : 'No cards');
      
      if (cards.length === 0) {
        console.log(`[direct/sync-keycrm] No more cards on page ${page}`);
        break;
      }

      totalCards += cards.length;
      console.log(`[direct/sync-keycrm] Processing ${cards.length} cards from page ${page}`);

      // Збираємо всіх клієнтів для батч-збереження
      const clientsToSave: DirectClient[] = [];

      for (const card of cards) {
        try {
          const instagram = extractInstagramFromCard(card);
          
          if (!instagram) {
            skippedNoInstagram++;
            continue;
          }

          // Перевіряємо, чи клієнт вже існує
          let client = await getDirectClientByInstagram(instagram);
          
          const nameData = extractNameFromCard(card);
          const now = new Date().toISOString();

          if (!client || !client.id) {
            // Створюємо нового клієнта
            const clientId = `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            client = {
              id: clientId,
              instagramUsername: instagram,
              firstName: nameData.firstName,
              lastName: nameData.lastName,
              source: 'instagram',
              // Стан "Лід" більше не використовуємо: стартуємо з "Розмова"
              state: 'message' as const,
              firstContactDate: now,
              statusId: defaultStatus?.id || 'new',
              visitedSalon: false,
              signedUpForPaidService: false,
              createdAt: now,
              updatedAt: now,
            };
            console.log(`[direct/sync-keycrm] Preparing new client: @${instagram} (state: message)`);
          } else {
            // Оновлюємо існуючого клієнта (не змінюємо state, якщо він вже є)
            client = {
              ...client,
              id: client.id,
              instagramUsername: instagram,
              ...(nameData.firstName && { firstName: nameData.firstName }),
              ...(nameData.lastName && { lastName: nameData.lastName }),
              updatedAt: now,
            };
            console.log(`[direct/sync-keycrm] Preparing update for client: @${instagram}`);
          }

          clientsToSave.push(client);
          if (client.id && !allSyncedClientIds.includes(client.id)) {
            allSyncedClientIds.push(client.id);
          }
          
          // Якщо досягли ліміту для тесту, зупиняємося
          if (maxClientsToSync && allSyncedClientIds.length >= maxClientsToSync) {
            console.log(`[direct/sync-keycrm] Reached max_clients limit: ${maxClientsToSync}`);
            break;
          }
        } catch (err) {
          console.error(`[direct/sync-keycrm] Error processing card ${card?.id}:`, err);
          errors++;
        }
      }

      // Якщо досягли ліміту для тесту, не обробляємо решту карток
      if (maxClientsToSync && allSyncedClientIds.length >= maxClientsToSync) {
        console.log(`[direct/sync-keycrm] Reached max_clients limit before processing batch`);
        break;
      }
      
      // Зберігаємо клієнтів батчами по 20
      const batchSize = 20;
      for (let i = 0; i < clientsToSave.length; i += batchSize) {
        const batch = clientsToSave.slice(i, i + batchSize);
        console.log(`[direct/sync-keycrm] Saving batch ${Math.floor(i / batchSize) + 1} (${batch.length} clients)`);
        
        // Зберігаємо клієнтів через saveDirectClient (правильно оновлює індекс з retry логікою)
        for (const client of batch) {
          try {
            await saveDirectClient(client, 'sync-keycrm', { source: 'keycrm' }, { touchUpdatedAt: false });
            console.log(`[direct/sync-keycrm] ✅ Saved client ${client.id} (@${client.instagramUsername})`);
            syncedClients++;
          } catch (err) {
            console.error(`[direct/sync-keycrm] Failed to save client ${client.id}:`, err);
            errors++;
          }
        }
        
        // Затримка між батчами для eventual consistency
        if (i + batchSize < clientsToSave.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // Перевіряємо, чи є наступна сторінка
      const hasNext = data?.next_page_url || 
                     (data?.current_page && data?.last_page && data.current_page < data.last_page) ||
                     (data?.meta?.current_page && data?.meta?.last_page && data.meta.current_page < data.meta.last_page);
      
      if (!hasNext) {
        console.log(`[direct/sync-keycrm] No more pages. Processed ${page} pages, ${totalCards} cards total`);
        break;
      }

      // Якщо досягли maxPages, зупиняємося
      if (page >= maxPages) {
        console.log(`[direct/sync-keycrm] Reached max pages limit: ${maxPages}`);
        break;
      }

      page++;
    }

    // Перевіряємо фінальний стан індексу (з затримкою для стабільності KV eventual consistency)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const finalIndexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let finalIndexLength = 0;
    let finalIndexIsArray = false;
    if (finalIndexData) {
      try {
        const parsed = typeof finalIndexData === 'string' ? JSON.parse(finalIndexData) : finalIndexData;
        finalIndexIsArray = Array.isArray(parsed);
        if (finalIndexIsArray) {
          finalIndexLength = parsed.length;
        }
      } catch (err) {
        console.error('[direct/sync-keycrm] Failed to parse final index:', err);
      }
    }

    // Якщо індекс порожній або не масив, але ми синхронізували клієнтів - спробуємо перебудувати індекс
    if (syncedClients > 0 && finalIndexLength === 0) {
      console.error('[direct/sync-keycrm] ⚠️ CRITICAL: Synced clients but index is empty! Attempting to rebuild index...');
      console.error('[direct/sync-keycrm] Debug info:', {
        syncedClients,
        finalIndexLength,
        finalIndexIsArray,
        allSyncedClientIdsCount: allSyncedClientIds.length,
        finalIndexDataRaw: finalIndexData ? (typeof finalIndexData === 'string' ? finalIndexData.slice(0, 200) : String(finalIndexData).slice(0, 200)) : null,
      });
      
      // Спробуємо знайти всіх клієнтів через пошук по ключам
      // Це не ідеально, але може допомогти в разі проблем з індексом
      try {
        // Використовуємо зібрані ID
        if (allSyncedClientIds.length > 0) {
          console.error(`[direct/sync-keycrm] Rebuilding index with ${allSyncedClientIds.length} client IDs`);
          const indexToSave = JSON.stringify(allSyncedClientIds);
          
          // Зберігаємо кілька разів для надійності
          for (let saveAttempt = 1; saveAttempt <= 3; saveAttempt++) {
            await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexToSave);
            console.log(`[direct/sync-keycrm] Index save attempt ${saveAttempt} completed`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Перевіряємо після кожного збереження
            const rebuiltIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
            if (rebuiltIndex) {
              try {
                const rebuiltParsed = typeof rebuiltIndex === 'string' ? JSON.parse(rebuiltIndex) : rebuiltIndex;
                if (Array.isArray(rebuiltParsed)) {
                  finalIndexLength = rebuiltParsed.length;
                  console.log(`[direct/sync-keycrm] ✅ Index verified after save attempt ${saveAttempt}: ${finalIndexLength} entries`);
                  if (finalIndexLength === allSyncedClientIds.length) {
                    console.log(`[direct/sync-keycrm] ✅ Index rebuild successful! All ${finalIndexLength} IDs are present.`);
                    break;
                  }
                } else {
                  console.warn(`[direct/sync-keycrm] Save attempt ${saveAttempt}: Index is not an array:`, typeof rebuiltParsed, rebuiltParsed);
                }
              } catch (parseErr) {
                console.warn(`[direct/sync-keycrm] Save attempt ${saveAttempt}: Failed to parse index:`, parseErr);
              }
            } else {
              console.warn(`[direct/sync-keycrm] Save attempt ${saveAttempt}: Index is null/undefined`);
            }
          }
          
          // Фінальна перевірка
          await new Promise(resolve => setTimeout(resolve, 2000));
          const finalCheck = await kvRead.getRaw(directKeys.CLIENT_INDEX);
          if (finalCheck) {
            try {
              const finalParsed = typeof finalCheck === 'string' ? JSON.parse(finalCheck) : finalCheck;
              if (Array.isArray(finalParsed)) {
                finalIndexLength = finalParsed.length;
                console.log(`[direct/sync-keycrm] Final index check: ${finalIndexLength} entries`);
              }
            } catch {}
          }
        } else {
          console.error('[direct/sync-keycrm] Cannot rebuild: allSyncedClientIds is empty!');
        }
      } catch (rebuildErr) {
        console.error('[direct/sync-keycrm] Failed to rebuild index:', rebuildErr);
      }
    }

    return NextResponse.json({
      ok: true,
      stats: {
        pagesScanned: page,
        totalCards,
        syncedClients,
        skippedNoInstagram,
        errors,
        finalIndexLength,
        finalIndexIsArray,
      },
      message: `Синхронізовано ${syncedClients} клієнтів. Індекс містить ${finalIndexLength} записів.`,
    });
  } catch (error) {
    console.error('[direct/sync-keycrm] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
