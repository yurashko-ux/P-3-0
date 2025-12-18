// web/app/api/admin/direct/rebuild-index/route.ts
// Ручне відновлення індексу клієнтів з KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';

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

    console.log('[direct/rebuild-index] Starting index rebuild...');

    // Читаємо поточний індекс
    const currentIndexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let existingIds: string[] = [];
    
    if (currentIndexData) {
      try {
        // Використовуємо unwrapKVResponse для правильного розгортання обгорток
        const parsed = unwrapKVResponse(currentIndexData);
        if (Array.isArray(parsed)) {
          existingIds = parsed
            .filter((id: any) => id !== null && id !== undefined)
            .filter((id: any): id is string => typeof id === 'string' && id.startsWith('direct_'));
        }
      } catch (err) {
        console.warn('[direct/rebuild-index] Failed to parse current index:', err);
      }
    }

    console.log(`[direct/rebuild-index] Current index has ${existingIds.length} IDs`);

    // Шукаємо всіх клієнтів через перевірку індексу по Instagram
    // Це не ідеально, але може допомогти знайти клієнтів, які не в індексі
    const foundIds = new Set<string>(existingIds);
    let checkedCount = 0;
    let foundCount = 0;

    // Перевіряємо клієнтів з поточного індексу
    for (const id of existingIds) {
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
        if (clientData) {
          // Використовуємо unwrapKVResponse для правильного розгортання обгорток
          const unwrapped = unwrapKVResponse(clientData);
          
          // Після розгортання, якщо це рядок, парсимо як JSON
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
            foundIds.add(client.id);
            foundCount++;
          }
        }
        checkedCount++;
      } catch (err) {
        console.warn(`[direct/rebuild-index] Failed to check client ${id}:`, err);
      }
    }

    console.log(`[direct/rebuild-index] Checked ${checkedCount} clients from index, found ${foundCount} valid`);

    // Якщо індекс порожній або малий, спробуємо знайти клієнтів через перевірку відомих Instagram usernames
    // або через перевірку клієнтів, які можуть бути в KV, але не в індексі
    if (foundIds.size < 10) {
      console.log('[direct/rebuild-index] Index is small, attempting to find clients via known Instagram usernames...');
      
      // Список відомих Instagram usernames для пошуку (можна розширити)
      const knownUsernames = [
        '_natali_231', // Клієнт, який був раніше
        'juliagricina',
        'lvivskacukerochka',
        '30.03.1994.m.r',
      ];
      
      for (const username of knownUsernames) {
        try {
          const instagramKey = directKeys.CLIENT_BY_INSTAGRAM(username);
          const idData = await kvRead.getRaw(instagramKey);
          
          if (idData) {
            // Розгортаємо обгортки
            let clientId: string | null = null;
            if (typeof idData === 'string') {
              try {
                const parsed = JSON.parse(idData);
                clientId = typeof parsed === 'string' ? parsed : String(parsed);
              } catch {
                clientId = idData;
              }
            } else if (typeof idData === 'object' && idData !== null) {
              clientId = (idData as any).value ?? (idData as any).id ?? String(idData);
            } else {
              clientId = String(idData);
            }
            
            if (clientId && clientId.startsWith('direct_')) {
              // Перевіряємо, чи клієнт існує
              const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(clientId));
              if (clientData) {
                foundIds.add(clientId);
                console.log(`[direct/rebuild-index] Found client via Instagram index: ${username} -> ${clientId}`);
              }
            }
          }
        } catch (err) {
          console.warn(`[direct/rebuild-index] Failed to check Instagram username ${username}:`, err);
        }
      }
      
      // Також спробуємо знайти клієнтів через перевірку конкретних ID, які можуть бути в KV
      // (наприклад, якщо ми знаємо ID з логів)
      const knownClientIds = [
        'direct_1766094118929_x1z9fbvy4', // ID з логів
      ];
      
      for (const clientId of knownClientIds) {
        if (!foundIds.has(clientId)) {
          try {
            const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(clientId));
            if (clientData) {
              // Розгортаємо обгортки
              const unwrapped = typeof clientData === 'string' 
                ? (() => { try { return JSON.parse(clientData); } catch { return clientData; } })()
                : clientData;
              
              // Перевіряємо, чи це валідний клієнт
              if (unwrapped && typeof unwrapped === 'object' && unwrapped.id && unwrapped.instagramUsername) {
                foundIds.add(clientId);
                console.log(`[direct/rebuild-index] Found client by direct ID check: ${clientId}`);
              }
            }
          } catch (err) {
            console.warn(`[direct/rebuild-index] Failed to check client ID ${clientId}:`, err);
          }
        }
      }
    }

    const finalIds = Array.from(foundIds);
    console.log(`[direct/rebuild-index] Rebuilding index with ${finalIds.length} client IDs`);

    // Зберігаємо новий індекс
    const indexJson = JSON.stringify(finalIds);
    await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexJson);
    
    // Затримка для eventual consistency
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Перевіряємо результат
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

    return NextResponse.json({
      ok: true,
      stats: {
        beforeRebuild: existingIds.length,
        afterRebuild: finalIds.length,
        verified: verifiedCount,
        checked: checkedCount,
        found: foundCount,
      },
      message: `Індекс відновлено: ${finalIds.length} клієнтів (перевірено: ${verifiedCount})`,
    });
  } catch (error) {
    console.error('[direct/rebuild-index] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
