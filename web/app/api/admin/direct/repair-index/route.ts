// web/app/api/admin/direct/repair-index/route.ts
// Відновлення індексу клієнтів з існуючих записів в KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';
import { getAllDirectStatuses } from '@/lib/direct-store';

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
 * POST - відновити індекси клієнтів та статусів
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо всіх клієнтів (навіть якщо індекс пошкоджений)
    // Шукаємо всі ключі, які починаються з direct:client:
    const allClients: any[] = [];
    const clientIds: string[] = [];
    
    // Спробуємо прочитати пошкоджений індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let parsedIndex: any = null;
    
    if (indexData) {
      try {
        if (typeof indexData === 'string') {
          parsedIndex = JSON.parse(indexData);
        } else {
          parsedIndex = indexData;
        }
      } catch (e) {
        console.warn('[repair-index] Failed to parse index:', e);
      }
    }
    
    // Якщо індекс - об'єкт, спробуємо знайти клієнтів через Instagram index
    if (parsedIndex && typeof parsedIndex === 'object' && !Array.isArray(parsedIndex)) {
      console.log('[repair-index] Index is object, trying to extract client IDs');
      // Можливо, в об'єкті є масив або список ID
      const possibleIds = Object.values(parsedIndex);
      for (const val of possibleIds) {
        if (typeof val === 'string' && val.startsWith('direct_')) {
          clientIds.push(val);
        } else if (Array.isArray(val)) {
          clientIds.push(...val.filter((id: any) => typeof id === 'string' && id.startsWith('direct_')));
        }
      }
    }
    
    // Спробуємо знайти клієнтів через Instagram index
    // Шукаємо всі ключі, які починаються з direct:by-instagram:
    // Це не ідеально, але може допомогти знайти клієнтів, навіть якщо основний індекс пошкоджений
    
    // Оскільки ми не можемо легко отримати список всіх ключів з KV,
    // спробуємо знайти клієнтів через тестові username або через перевірку існуючих клієнтів
    // Найкращий спосіб - перевірити, чи є клієнти через Instagram index для відомих username
    
    // Якщо у нас є хоча б один клієнт, спробуємо знайти інших через перевірку існуючих записів
    // Але оскільки ми не можемо отримати список всіх ключів, покладаємося на те,
    // що клієнти зберігаються з правильним Instagram index
    
    // Тепер читаємо всіх знайдених клієнтів
    const foundClients: any[] = [];
    const foundClientIds = new Set<string>();
    
    for (const id of clientIds) {
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
        if (clientData) {
          const client = typeof clientData === 'string' ? JSON.parse(clientData) : clientData;
          if (client && client.id && client.instagramUsername) {
            foundClients.push(client);
            foundClientIds.add(client.id);
          }
        }
      } catch (e) {
        console.warn(`[repair-index] Failed to read client ${id}:`, e);
      }
    }
    
    // Додатково: спробуємо знайти клієнтів через Instagram index
    // Перевіряємо відомі username (можна розширити список)
    const knownUsernames = ['mykolayyurashko']; // Можна додати інші
    for (const username of knownUsernames) {
      try {
        const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(username));
        if (idData) {
          let id: string;
          if (typeof idData === 'string') {
            try {
              id = JSON.parse(idData);
            } catch {
              id = idData;
            }
          } else {
            id = String(idData);
          }
          
          if (typeof id === 'string' && id.startsWith('direct_') && !foundClientIds.has(id)) {
            try {
              const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
              if (clientData) {
                const client = typeof clientData === 'string' ? JSON.parse(clientData) : clientData;
                if (client && client.id && client.instagramUsername) {
                  foundClients.push(client);
                  foundClientIds.add(client.id);
                }
              }
            } catch (e) {
              console.warn(`[repair-index] Failed to read client from Instagram index ${id}:`, e);
            }
          }
        }
      } catch (e) {
        // Ігноруємо помилки
      }
    }
    
    // Відновлюємо індекс клієнтів
    const recoveredClientIds = Array.from(foundClientIds);
    if (recoveredClientIds.length > 0) {
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(recoveredClientIds));
      console.log(`[repair-index] Recovered ${recoveredClientIds.length} client IDs:`, recoveredClientIds);
    } else {
      // Якщо нічого не знайдено, створюємо порожній індекс
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify([]));
      console.log('[repair-index] No clients found, created empty index');
    }
    
    // Відновлюємо індекс статусів
    const statuses = await getAllDirectStatuses();
    const statusIds = statuses.map(s => s.id);
    await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify(statusIds));
    console.log(`[repair-index] Recovered ${statusIds.length} status IDs`);
    
    return NextResponse.json({
      ok: true,
      recovered: {
        clients: recoveredClientIds.length,
        statuses: statusIds.length,
      },
      clients: foundClients,
    });
  } catch (error) {
    console.error('[repair-index] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
