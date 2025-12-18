// web/app/api/admin/direct/recover-client/route.ts
// Швидке відновлення конкретного клієнта в індекс

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';
import { getAllDirectClients } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';

// Копіюємо unwrapKVResponse
function unwrapKVResponse(data: any, maxAttempts = 20): any {
  let current: any = data;
  let attempts = 0;
  let lastStringValue: string | null = null;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    if (Array.isArray(current)) {
      const filtered = current.filter(item => item !== null && item !== undefined);
      return filtered.length > 0 ? filtered : current;
    }
    
    if (typeof current === 'string') {
      if (!current.trim()) {
        return current;
      }
      
      const trimmed = current.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        if (lastStringValue === current) {
          try {
            const parsed = JSON.parse(current);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const extracted = parsed.value ?? parsed.result ?? parsed.data;
              if (extracted !== undefined && extracted !== null) {
                current = extracted;
                lastStringValue = null;
                continue;
              }
            }
            return parsed;
          } catch {
            return current;
          }
        }
        
        lastStringValue = current;
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
        lastStringValue = null;
        continue;
      }
    }
    
    if (current === null || current === undefined || typeof current !== 'object') {
      return current;
    }
    
    break;
  }
  
  if (typeof current === 'string' && current.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(current);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => item !== null && item !== undefined);
      }
      return parsed;
    } catch {
      // ignore
    }
  }
  
  return current;
}

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

    console.log('[direct/recover-client] Starting client recovery...');

    // Отримуємо всіх клієнтів (навіть якщо індекс порожній, можливо вони є в KV)
    const allClients = await getAllDirectClients();
    console.log(`[direct/recover-client] Found ${allClients.length} clients via getAllDirectClients`);

    // Якщо клієнтів немає, спробуємо знайти через відомі Instagram usernames
    const knownUsernames = ['_natali_231'];
    const recoveredClients: string[] = [];

    for (const username of knownUsernames) {
      try {
        const instagramKey = directKeys.CLIENT_BY_INSTAGRAM(username);
        const idData = await kvRead.getRaw(instagramKey);
        
        if (idData) {
          let clientId: string | null = null;
          const unwrapped = unwrapKVResponse(idData);
          
          if (typeof unwrapped === 'string') {
            try {
              const parsed = JSON.parse(unwrapped);
              clientId = typeof parsed === 'string' ? parsed : String(parsed);
            } catch {
              clientId = unwrapped;
            }
          } else if (typeof unwrapped === 'object' && unwrapped !== null) {
            clientId = (unwrapped as any).value ?? (unwrapped as any).id ?? String(unwrapped);
          } else {
            clientId = String(unwrapped);
          }
          
          if (clientId && clientId.startsWith('direct_')) {
            // Перевіряємо, чи клієнт існує
            const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(clientId));
            if (clientData) {
              const unwrappedClient = unwrapKVResponse(clientData);
              let client: any;
              if (typeof unwrappedClient === 'string') {
                try {
                  client = JSON.parse(unwrappedClient);
                } catch {
                  client = unwrappedClient;
                }
              } else {
                client = unwrappedClient;
              }
              
              if (client && typeof client === 'object' && client.id && client.instagramUsername) {
                recoveredClients.push(clientId);
                console.log(`[direct/recover-client] Found client via Instagram: ${username} -> ${clientId}`);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[direct/recover-client] Failed to check Instagram username ${username}:`, err);
      }
    }

    // Також спробуємо знайти через відомий ID
    const knownClientIds = ['direct_1766094118929_x1z9fbvy4'];
    for (const clientId of knownClientIds) {
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(clientId));
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
            if (!recoveredClients.includes(clientId)) {
              recoveredClients.push(clientId);
              console.log(`[direct/recover-client] Found client by direct ID: ${clientId}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[direct/recover-client] Failed to check client ID ${clientId}:`, err);
      }
    }

    // Збираємо всі ID клієнтів (з getAllDirectClients + знайдені)
    const allClientIds = new Set<string>();
    
    // Додаємо ID з getAllDirectClients
    for (const client of allClients) {
      if (client.id) {
        allClientIds.add(client.id);
      }
    }
    
    // Додаємо знайдені клієнти
    for (const clientId of recoveredClients) {
      allClientIds.add(clientId);
    }

    // Оновлюємо індекс
    const finalIds = Array.from(allClientIds);
    console.log(`[direct/recover-client] Rebuilding index with ${finalIds.length} client IDs`);

    if (finalIds.length > 0) {
      const indexJson = JSON.stringify(finalIds);
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexJson);
      
      // Затримка для eventual consistency
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Перевіряємо результат
      const verifyIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      let verifiedCount = 0;
      if (verifyIndex) {
        try {
          const verifyParsed = unwrapKVResponse(verifyIndex);
          if (Array.isArray(verifyParsed)) {
            verifiedCount = verifyParsed.length;
          }
        } catch {}
      }

      return NextResponse.json({
        ok: true,
        stats: {
          foundViaGetAll: allClients.length,
          foundViaInstagram: recoveredClients.length,
          totalInIndex: finalIds.length,
          verified: verifiedCount,
        },
        message: `Відновлено ${finalIds.length} клієнтів в індекс (перевірено: ${verifiedCount})`,
      });
    } else {
      return NextResponse.json({
        ok: false,
        message: 'Клієнти не знайдені. Спробуйте синхронізувати з KeyCRM або ManyChat.',
      });
    }
  } catch (error) {
    console.error('[direct/recover-client] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
