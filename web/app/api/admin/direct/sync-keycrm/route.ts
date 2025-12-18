// web/app/api/admin/direct/sync-keycrm/route.ts
// Синхронізація клієнтів з KeyCRM в розділ Direct

import { NextRequest, NextResponse } from 'next/server';
import { resolveKeycrmBaseUrl, resolveKeycrmBearer, resolveKeycrmToken } from '@/lib/env';
import { getDirectClientByInstagram, getAllDirectStatuses } from '@/lib/direct-store';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';
import type { DirectClient } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';

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
  // Спробуємо різні місця, де може бути Instagram username
  const candidates = [
    card?.contact?.social_id,
    card?.contact?.client?.social_id,
    card?.contact?.instagram,
    card?.contact?.client?.instagram,
    card?.social_id,
    card?.instagram,
    // Custom fields
    card?.contact?.custom_fields?.instagram,
    card?.contact?.client?.custom_fields?.instagram,
    card?.custom_fields?.instagram,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeInstagram(candidate);
    if (normalized) return normalized;
  }

  return null;
}

// Витягування імені з картки
function extractNameFromCard(card: any): { firstName?: string; lastName?: string; fullName?: string } {
  const contact = card?.contact || card?.contact?.client;
  const fullName = contact?.full_name || contact?.name || card?.title || null;
  
  if (fullName) {
    const parts = fullName.trim().split(' ');
    return {
      fullName,
      firstName: parts[0] || undefined,
      lastName: parts.slice(1).join(' ') || undefined,
    };
  }

  return {
    firstName: contact?.first_name || undefined,
    lastName: contact?.last_name || undefined,
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
    const maxPages = Math.min(Math.max(body.max_pages || body.maxPages || 5, 1), 20);

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

    while (page <= maxPages) {
      // Формуємо URL для отримання карток
      let path = '/pipelines/cards';
      const params = new URLSearchParams();
      params.set('page[number]', String(page));
      params.set('page[size]', String(perPage));
      
      // Додаємо include для отримання контактів
      params.append('include[]', 'contact');
      params.append('include[]', 'contact.client');
      params.append('include[]', 'status');

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
      const cards = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      
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
              firstContactDate: now,
              statusId: defaultStatus?.id || 'new',
              visitedSalon: false,
              signedUpForPaidService: false,
              createdAt: now,
              updatedAt: now,
            };
            console.log(`[direct/sync-keycrm] Preparing new client: @${instagram}`);
          } else {
            // Оновлюємо існуючого клієнта
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
        } catch (err) {
          console.error(`[direct/sync-keycrm] Error processing card ${card?.id}:`, err);
          errors++;
        }
      }

      // Зберігаємо клієнтів батчами по 20
      const batchSize = 20;
      for (let i = 0; i < clientsToSave.length; i += batchSize) {
        const batch = clientsToSave.slice(i, i + batchSize);
        console.log(`[direct/sync-keycrm] Saving batch ${Math.floor(i / batchSize) + 1} (${batch.length} clients)`);
        
        // Спочатку зберігаємо всіх клієнтів
        for (const client of batch) {
          try {
            await kvWrite.setRaw(directKeys.CLIENT_ITEM(client.id), JSON.stringify(client));
            const normalizedUsername = client.instagramUsername.toLowerCase().trim();
            await kvWrite.setRaw(
              directKeys.CLIENT_BY_INSTAGRAM(normalizedUsername),
              JSON.stringify(client.id)
            );
          } catch (err) {
            console.error(`[direct/sync-keycrm] Failed to save client ${client.id}:`, err);
            errors++;
          }
        }

        // Потім оновлюємо індекс одним запитом
        try {
          const currentIndexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
          let currentIds: string[] = [];
          
          if (currentIndexData) {
            try {
              const parsed = typeof currentIndexData === 'string' ? JSON.parse(currentIndexData) : currentIndexData;
              if (Array.isArray(parsed)) {
                currentIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.startsWith('direct_'));
              }
            } catch {}
          }

          // Додаємо нові ID з батча
          for (const client of batch) {
            if (!currentIds.includes(client.id)) {
              currentIds.push(client.id);
            }
          }

          // Зберігаємо оновлений індекс
          await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(currentIds));
          
          // Затримка для стабільності KV (eventual consistency)
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Перевіряємо, чи індекс зберігся
          const verifyIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
          let verifiedCount = 0;
          if (verifyIndex) {
            try {
              const verifyParsed = typeof verifyIndex === 'string' ? JSON.parse(verifyIndex) : verifyIndex;
              if (Array.isArray(verifyParsed)) {
                verifiedCount = verifyParsed.length;
              }
            } catch {}
          }
          
          syncedClients += batch.length;
          
          console.log(`[direct/sync-keycrm] Batch saved. Expected in index: ${currentIds.length}, verified: ${verifiedCount}, synced: ${syncedClients}`);
          
          if (verifiedCount !== currentIds.length) {
            console.warn(`[direct/sync-keycrm] ⚠️ Index count mismatch! Expected ${currentIds.length}, got ${verifiedCount}. Retrying...`);
            // Спробуємо зберегти ще раз
            await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(currentIds));
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          // Невелика затримка між батчами
          if (i + batchSize < clientsToSave.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (err) {
          console.error(`[direct/sync-keycrm] Failed to update index for batch:`, err);
          errors += batch.length;
        }
      }

      // Перевіряємо, чи є наступна сторінка
      const hasNext = data?.next_page_url || (data?.current_page && data?.last_page && data.current_page < data.last_page);
      if (!hasNext) {
        console.log(`[direct/sync-keycrm] No more pages`);
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
      console.warn('[direct/sync-keycrm] ⚠️ WARNING: Synced clients but index is empty! Attempting to rebuild index...');
      
      // Спробуємо знайти всіх клієнтів через пошук по ключам
      // Це не ідеально, але може допомогти в разі проблем з індексом
      try {
        // Використовуємо зібрані ID
        if (allSyncedClientIds.length > 0) {
          console.log(`[direct/sync-keycrm] Rebuilding index with ${allSyncedClientIds.length} client IDs`);
          await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(allSyncedClientIds));
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Перевіряємо ще раз
          const rebuiltIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
          if (rebuiltIndex) {
            try {
              const rebuiltParsed = typeof rebuiltIndex === 'string' ? JSON.parse(rebuiltIndex) : rebuiltIndex;
              if (Array.isArray(rebuiltParsed)) {
                finalIndexLength = rebuiltParsed.length;
                console.log(`[direct/sync-keycrm] ✅ Index rebuilt successfully: ${finalIndexLength} entries`);
              }
            } catch {}
          }
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
