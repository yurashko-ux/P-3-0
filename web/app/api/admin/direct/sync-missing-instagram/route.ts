// web/app/api/admin/direct/sync-missing-instagram/route.ts
// Обробка всіх вебхуків від Altegio, які не мають Instagram username
// Разова початкова дія для заповнення бази клієнтами без Instagram

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
 * POST - обробити всі вебхуки від Altegio, які не мають Instagram username
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[direct/sync-missing-instagram] Processing all webhooks for clients without Instagram`);

    // Отримуємо всі вебхуки з логу (можна збільшити ліміт, якщо потрібно)
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 9999);
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

    // Фільтруємо вебхуки, які стосуються клієнтів
    const clientEvents = events.filter((e: any) => {
      return e.body?.resource === 'client' && (e.body?.status === 'create' || e.body?.status === 'update');
    });

    console.log(`[direct/sync-missing-instagram] Found ${clientEvents.length} client events total`);

    // Імпортуємо функції для обробки вебхуків
    const { getAllDirectClients, getAllDirectStatuses, saveDirectClient, getDirectClientByAltegioId } = await import('@/lib/direct-store');
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
      totalEvents: clientEvents.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      skippedAlreadyExists: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Обробляємо кожен вебхук
    for (const event of clientEvents) {
      try {
        const clientId = event.body?.resource_id;
        const client = event.body?.data?.client || event.body?.data;

        if (!clientId || !client) {
          results.skipped++;
          continue;
        }

        const altegioClientId = parseInt(String(clientId), 10);

        // Перевіряємо, чи вже існує клієнт з таким altegioClientId
        const existingClientByAltegioId = await getDirectClientByAltegioId(altegioClientId);
        if (existingClientByAltegioId) {
          // Якщо клієнт вже існує і має нормальний Instagram (не тимчасовий), пропускаємо
          if (!existingClientByAltegioId.instagramUsername.startsWith('missing_instagram_')) {
            results.skippedAlreadyExists++;
            continue;
          }
        }

        // Витягуємо Instagram username
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

        // Якщо є Instagram, пропускаємо (ми шукаємо тільки тих, хто не має Instagram)
        if (instagram) {
          const normalized = normalizeInstagram(instagram);
          if (normalized) {
            results.skipped++;
            continue;
          }
        }

        // Якщо немає Instagram, створюємо/оновлюємо клієнта зі станом "no-instagram"
        const normalizedInstagram = `missing_instagram_${clientId}`;

        // Витягуємо ім'я
        const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        // Шукаємо існуючого клієнта
        let existingClientId = existingAltegioIdMap.get(altegioClientId);

        if (existingClientId) {
          // Оновлюємо існуючого клієнта
          const { getDirectClient } = await import('@/lib/direct-store');
          const existingClient = await getDirectClient(existingClientId);
          if (existingClient) {
            const updated = {
              ...existingClient,
              altegioClientId: altegioClientId,
              instagramUsername: normalizedInstagram,
              state: 'no-instagram' as const,
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
              state: 'no-instagram',
            });
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
            state: 'no-instagram' as const,
            firstContactDate: now,
            statusId: defaultStatus.id,
            visitedSalon: false,
            signedUpForPaidService: false,
            altegioClientId: altegioClientId,
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
            state: 'no-instagram',
          });
        }

        results.processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(errorMsg);
        console.error(`[direct/sync-missing-instagram] Error processing event:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Processed all webhooks for clients without Instagram',
      ...results,
    });
  } catch (error) {
    console.error('[direct/sync-missing-instagram] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

