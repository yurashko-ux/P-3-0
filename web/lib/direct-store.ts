// web/lib/direct-store.ts
// Функції для роботи з Direct клієнтами та статусами в KV

import { kvRead, kvWrite, directKeys } from './kv';
import type { DirectClient, DirectStatus } from './direct-types';

/**
 * Рекурсивно розгортає KV відповідь, поки не отримаємо масив або примітивне значення
 * KV може повертати подвійну обгортку: '{"value":"[\\"id\\"]"}' → {value: '["id"]'} → ["id"]
 * Або навіть потрійну: '{"value":"{\\"value\\":\\"[\\\\\\"id\\\\\\"]\\"}"}'
 */
function unwrapKVResponse(data: any, maxAttempts = 20): any {
  let current: any = data;
  let attempts = 0;
  const seenStrings = new Set<string>(); // Відстежуємо вже бачені рядки для запобігання циклів
  
  // Продовжуємо розгортати, поки не отримаємо масив або не досягнемо ліміту спроб
  while (attempts < maxAttempts) {
    attempts++;
    
    // Якщо це масив - повертаємо його (після фільтрації null)
    if (Array.isArray(current)) {
      const filtered = current.filter(item => item !== null && item !== undefined);
      return filtered.length > 0 ? filtered : current;
    }
    
    // Якщо це рядок, спробуємо розпарсити як JSON
    if (typeof current === 'string') {
      // Якщо рядок порожній, повертаємо як є
      if (!current.trim()) {
        return current;
      }
      
      const trimmed = current.trim();
      
      // Якщо рядок виглядає як JSON (починається з { або [), спробуємо розпарсити
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        // Запобігаємо нескінченному циклу: якщо цей рядок вже бачили, спробуємо розпарсити і повернути
        if (seenStrings.has(current)) {
          try {
            const parsed = JSON.parse(current);
            // Якщо це масив - повертаємо
            if (Array.isArray(parsed)) {
              return parsed.filter(item => item !== null && item !== undefined);
            }
            // Якщо це об'єкт, витягуємо value/result/data і продовжуємо
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const extracted = parsed.value ?? parsed.result ?? parsed.data;
              if (extracted !== undefined && extracted !== null) {
                current = extracted;
                seenStrings.delete(current); // Видаляємо з seen, щоб можна було продовжити
                continue;
              }
            }
            return parsed;
          } catch {
            return current;
          }
        }
        
        // Додаємо рядок до seen перед парсингом
        seenStrings.add(current);
        
        try {
          const parsed = JSON.parse(current);
          current = parsed;
          continue; // Продовжуємо розгортання
        } catch {
          // Якщо не вдалося розпарсити, повертаємо як є
          return current;
        }
      } else {
        // Якщо рядок не виглядає як JSON, повертаємо як є
        return current;
      }
    }
    
    // Якщо це об'єкт (не масив), витягуємо value/result/data
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const extracted = (current as any).value ?? (current as any).result ?? (current as any).data;
      if (extracted !== undefined && extracted !== null) {
        current = extracted;
        // Якщо витягли рядок, очищаємо seen для нього, щоб можна було парсити
        if (typeof extracted === 'string') {
          seenStrings.delete(extracted);
        }
        continue; // Продовжуємо розгортання
      }
    }
    
    // Якщо це null, undefined, number, boolean - повертаємо як є
    if (current === null || current === undefined || typeof current !== 'object') {
      return current;
    }
    
    // Якщо не вдалося розгорнути далі, зупиняємося
    break;
  }
  
  // Якщо досягли ліміту спроб, спробуємо останній раз розпарсити як JSON, якщо це рядок
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(current);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => item !== null && item !== undefined);
        }
        // Якщо це об'єкт, витягуємо value/result/data
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const extracted = parsed.value ?? parsed.result ?? parsed.data;
          if (extracted !== undefined && extracted !== null) {
            // Рекурсивно викликаємо для витягнутого значення
            return unwrapKVResponse(extracted, 5);
          }
        }
        return parsed;
      } catch {
        // Ігноруємо помилку
      }
    }
  }
  
  return current;
}

/**
 * Отримати всіх клієнтів
 */
export async function getAllDirectClients(): Promise<DirectClient[]> {
  try {
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    if (!indexData) {
      console.log('[direct-store] No client index found');
      return [];
    }

    // Обробляємо різні формати даних - рекурсивно розгортаємо обгортки
    const parsed = unwrapKVResponse(indexData);
    
    // Перевіряємо, чи це масив
    if (!Array.isArray(parsed)) {
      console.error('[direct-store] ⚠️ CRITICAL: Client index data is not an array after unwrapping!', {
        finalType: typeof parsed,
        finalValue: parsed,
        originalType: typeof indexData,
        originalValue: typeof indexData === 'string' ? indexData.slice(0, 200) : String(indexData).slice(0, 200),
      });
      // НЕ скидаємо індекс автоматично - це може бути тимчасовий стан під час запису
      console.warn('[direct-store] Returning empty array without resetting index (may be temporary state)');
      return [];
    }

    // Гарантуємо, що це масив рядків (фільтруємо null, undefined та невалідні значення)
    const clientIds: string[] = parsed
      .filter((id: any) => id !== null && id !== undefined) // Спочатку прибираємо null/undefined
      .filter((id: any): id is string => 
        typeof id === 'string' && id.length > 0 && id.startsWith('direct_')
      );
    
    console.log(`[direct-store] getAllDirectClients: Found ${clientIds.length} client IDs in index`);

    const clients: DirectClient[] = [];
    let loadedCount = 0;
    let errorCount = 0;

    for (const id of clientIds) {
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
        if (clientData) {
          try {
            // Рекурсивно розгортаємо обгортки KV (як для індексу)
            const unwrapped = unwrapKVResponse(clientData);
            
            // Після розгортання, якщо це рядок, парсимо як JSON
            let client: any;
            if (typeof unwrapped === 'string') {
              try {
                client = JSON.parse(unwrapped);
              } catch {
                // Якщо не JSON, спробуємо як об'єкт
                client = unwrapped;
              }
            } else {
              client = unwrapped;
            }
            
            // Перевіряємо валідність клієнта
            if (client && typeof client === 'object' && client.id && client.instagramUsername) {
              clients.push(client);
              loadedCount++;
            } else {
              console.warn(`[direct-store] Invalid client data for ${id}:`, {
                hasId: !!client?.id,
                hasUsername: !!client?.instagramUsername,
                unwrappedType: typeof unwrapped,
                unwrappedPreview: typeof unwrapped === 'string' ? unwrapped.slice(0, 100) : String(unwrapped).slice(0, 100),
              });
              errorCount++;
            }
          } catch (parseErr) {
            console.warn(`[direct-store] Failed to parse client ${id}:`, parseErr);
            errorCount++;
          }
        } else {
          console.warn(`[direct-store] Client ${id} not found in KV`);
          errorCount++;
        }
      } catch (readErr) {
        console.warn(`[direct-store] Failed to read client ${id}:`, readErr);
        errorCount++;
      }
    }

    console.log(`[direct-store] getAllDirectClients: Loaded ${loadedCount} clients, ${errorCount} errors`);
    return clients;
  } catch (err) {
    console.error('[direct-store] Failed to get all clients:', err);
    return [];
  }
}

/**
 * Отримати клієнта за ID
 */
export async function getDirectClient(id: string): Promise<DirectClient | null> {
  try {
    const data = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
    if (!data) return null;
    
    // Рекурсивно розгортаємо обгортки KV
    const unwrapped = unwrapKVResponse(data);
    
    // Після розгортання, якщо це рядок, парсимо як JSON
    if (typeof unwrapped === 'string') {
      try {
        return JSON.parse(unwrapped);
      } catch {
        return null;
      }
    }
    
    return unwrapped as DirectClient;
  } catch (err) {
    console.error(`[direct-store] Failed to get client ${id}:`, err);
    return null;
  }
}

/**
 * Отримати клієнта за Instagram username
 */
export async function getDirectClientByInstagram(username: string): Promise<DirectClient | null> {
  try {
    const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(username.toLowerCase().trim()));
    if (!idData) return null;
    
    // Обробляємо різні формати даних з KV
    let id: string;
    if (typeof idData === 'string') {
      try {
        const parsed = JSON.parse(idData);
        id = typeof parsed === 'string' ? parsed : String(parsed);
      } catch {
        id = idData; // Якщо це вже рядок без JSON
      }
    } else if (typeof idData === 'object' && idData !== null) {
      // Якщо це об'єкт, намагаємося витягти ID
      id = (idData as any).id || String(idData);
    } else {
      id = String(idData);
    }
    
    if (!id || typeof id !== 'string') {
      console.warn(`[direct-store] Invalid client ID format for Instagram ${username}:`, idData);
      return null;
    }
    
    return getDirectClient(id);
  } catch (err) {
    console.error(`[direct-store] Failed to get client by Instagram ${username}:`, err);
    return null;
  }
}

/**
 * Зберегти клієнта
 */
export async function saveDirectClient(client: DirectClient): Promise<void> {
  try {
    // Зберігаємо клієнта
    await kvWrite.setRaw(directKeys.CLIENT_ITEM(client.id), JSON.stringify(client));

    // Додаємо в індекс з retry логікою для уникнення race conditions
    let retries = 3;
    let added = false;
    
    while (retries > 0 && !added) {
      const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      let clientIds: string[] = [];
      
      if (indexData) {
        try {
          // Рекурсивно розгортаємо обгортки
          const parsed = unwrapKVResponse(indexData);
          
          if (Array.isArray(parsed)) {
            clientIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.startsWith('direct_'));
          } else {
            // Якщо індекс пошкоджений, скидаємо його
            console.warn('[direct-store] Client index is not an array when saving, resetting');
            clientIds = [];
          }
        } catch (parseErr) {
          console.warn('[direct-store] Failed to parse client index when saving, resetting:', parseErr);
          clientIds = [];
        }
      }
      
      if (!clientIds.includes(client.id)) {
        clientIds.push(client.id);
        const indexJson = JSON.stringify(clientIds);
        await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexJson);
        
        // Затримка для стабільності KV (eventual consistency)
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Перевіряємо, чи індекс зберігся правильно
        const verifyIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
        if (verifyIndex) {
          try {
            const verifyParsed = unwrapKVResponse(verifyIndex);
            if (Array.isArray(verifyParsed) && verifyParsed.includes(client.id)) {
              added = true;
              console.log(`[direct-store] ✅ Added client ${client.id} to index. Total: ${clientIds.length}`);
            }
          } catch {}
        }
        
        if (!added && retries > 1) {
          console.warn(`[direct-store] Index verification failed, retrying... (${retries - 1} attempts left)`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 100));
        } else if (!added) {
          console.error(`[direct-store] ⚠️ WARNING: Failed to verify index after ${retries} attempts for client ${client.id}`);
          retries = 0;
        }
      } else {
        added = true;
        console.log(`[direct-store] ℹ️ Client ${client.id} already in index`);
      }
    }

    // Зберігаємо індекс по Instagram username для швидкого пошуку
    // Нормалізуємо username до нижнього регістру для консистентності
    const normalizedUsername = client.instagramUsername.toLowerCase().trim();
    await kvWrite.setRaw(
      directKeys.CLIENT_BY_INSTAGRAM(normalizedUsername),
      JSON.stringify(client.id)
    );
    console.log(`[direct-store] ✅ Saved Instagram index: ${normalizedUsername} -> ${client.id}`);
  } catch (err) {
    console.error(`[direct-store] Failed to save client ${client.id}:`, err);
    throw err;
  }
}

/**
 * Видалити клієнта
 */
export async function deleteDirectClient(id: string): Promise<void> {
  try {
    // Отримуємо клієнта, щоб знати Instagram username
    const client = await getDirectClient(id);
    if (client) {
      // Видаляємо індекс по Instagram username
      await kvWrite.setRaw(directKeys.CLIENT_BY_INSTAGRAM(client.instagramUsername), '');
    }

    // Видаляємо клієнта
    await kvWrite.setRaw(directKeys.CLIENT_ITEM(id), '');

    // Видаляємо з індексу
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    if (indexData) {
      const clientIds: string[] = JSON.parse(indexData);
      const filtered = clientIds.filter((cid) => cid !== id);
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(filtered));
    }
  } catch (err) {
    console.error(`[direct-store] Failed to delete client ${id}:`, err);
    throw err;
  }
}

/**
 * Отримати всі статуси
 */
export async function getAllDirectStatuses(): Promise<DirectStatus[]> {
  try {
    const indexData = await kvRead.getRaw(directKeys.STATUS_INDEX);
    if (!indexData) {
      // Якщо індексу немає, ініціалізуємо початкові статуси
      await initializeDefaultStatuses();
      const indexDataAfterInit = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (!indexDataAfterInit) return [];
      // Продовжуємо з новими даними (але без рекурсії, щоб уникнути циклу)
      const newParsed = unwrapKVResponse(indexDataAfterInit);
      if (!Array.isArray(newParsed)) return [];
      const statusIds = newParsed.filter((id: any): id is string => typeof id === 'string');
      return await loadStatusesByIds(statusIds);
    }

    // Обробляємо різні формати даних - рекурсивно розгортаємо обгортки
    let parsed = unwrapKVResponse(indexData);
    
    if (!parsed || parsed === null) {
      // Якщо індексу немає, ініціалізуємо початкові статуси
      await initializeDefaultStatuses();
      const indexDataAfterInit = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (!indexDataAfterInit) return [];
      const newParsed = unwrapKVResponse(indexDataAfterInit);
      if (!Array.isArray(newParsed)) return [];
      const statusIds = newParsed.filter((id: any): id is string => typeof id === 'string');
      return await loadStatusesByIds(statusIds);
    }
    
    // Перевіряємо, чи це масив
    if (!Array.isArray(parsed)) {
      // Якщо індекс пошкоджений (об'єкт замість масиву), скидаємо його
      console.warn('[direct-store] Status index data is an object, not array. Resetting index.');
      await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify([]));
      // Ініціалізуємо початкові статуси
      await initializeDefaultStatuses();
      // Читаємо знову, але без рекурсії
      const indexDataAfterInit = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (!indexDataAfterInit) return [];
      const newParsed = unwrapKVResponse(indexDataAfterInit);
      if (!Array.isArray(newParsed)) return [];
      parsed = newParsed;
    }

    // Гарантуємо, що це масив рядків
    const statusIds: string[] = parsed.filter((id: any): id is string => 
      typeof id === 'string' && id.length > 0
    );
    return await loadStatusesByIds(statusIds);
  } catch (err) {
    console.error('[direct-store] Failed to get all statuses:', err);
    return [];
  }
}

/**
 * Допоміжна функція для завантаження статусів за ID (без рекурсії)
 */
async function loadStatusesByIds(statusIds: string[]): Promise<DirectStatus[]> {
  const statuses: DirectStatus[] = [];

  for (const id of statusIds) {
    try {
      const statusData = await kvRead.getRaw(directKeys.STATUS_ITEM(id));
      if (statusData) {
        try {
          const status = typeof statusData === 'string' ? JSON.parse(statusData) : statusData;
          if (status && typeof status === 'object' && status.id) {
            statuses.push(status);
          }
        } catch (parseErr) {
          console.warn(`[direct-store] Failed to parse status ${id}:`, parseErr);
        }
      }
    } catch (readErr) {
      console.warn(`[direct-store] Failed to read status ${id}:`, readErr);
    }
  }

  // Сортуємо по order
  return statuses.sort((a, b) => a.order - b.order);
}

/**
 * Отримати статус за ID
 */
export async function getDirectStatus(id: string): Promise<DirectStatus | null> {
  try {
    const data = await kvRead.getRaw(directKeys.STATUS_ITEM(id));
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.error(`[direct-store] Failed to get status ${id}:`, err);
    return null;
  }
}

/**
 * Зберегти статус
 */
export async function saveDirectStatus(status: DirectStatus): Promise<void> {
  try {
    console.log(`[direct-store] Saving status ${status.id} (${status.name})`);
    
    // Зберігаємо статус
    await kvWrite.setRaw(directKeys.STATUS_ITEM(status.id), JSON.stringify(status));
    console.log(`[direct-store] ✅ Status ${status.id} saved to KV`);

    // Додаємо в індекс з retry логікою для уникнення race conditions
    let retries = 3;
    let added = false;
    
    while (retries > 0 && !added) {
      const indexData = await kvRead.getRaw(directKeys.STATUS_INDEX);
      let statusIds: string[] = [];
      
      if (indexData) {
        try {
          // Рекурсивно розгортаємо обгортки
          const parsed = unwrapKVResponse(indexData);
          
          if (Array.isArray(parsed)) {
            statusIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.length > 0);
            console.log(`[direct-store] Found ${statusIds.length} existing status IDs in index`);
          } else {
            // Якщо індекс пошкоджений, скидаємо його
            console.warn('[direct-store] Status index is not an array when saving, resetting. Type:', typeof parsed, 'Value:', parsed);
            statusIds = [];
          }
        } catch (parseErr) {
          console.warn('[direct-store] Failed to parse status index when saving, resetting:', parseErr);
          statusIds = [];
        }
      } else {
        console.log('[direct-store] No existing status index found, creating new one');
      }
      
      if (!statusIds.includes(status.id)) {
        statusIds.push(status.id);
        const indexJson = JSON.stringify(statusIds);
        console.log(`[direct-store] Saving status index with ${statusIds.length} IDs:`, statusIds);
        await kvWrite.setRaw(directKeys.STATUS_INDEX, indexJson);
        
        // Затримка для стабільності KV (eventual consistency)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Перевіряємо, чи індекс зберігся правильно (кілька спроб)
        for (let verifyAttempt = 1; verifyAttempt <= 3; verifyAttempt++) {
          await new Promise(resolve => setTimeout(resolve, 200));
          const verifyIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
          if (verifyIndex) {
            try {
              const verifyParsed = unwrapKVResponse(verifyIndex);
              if (Array.isArray(verifyParsed)) {
                if (verifyParsed.includes(status.id)) {
                  added = true;
                  console.log(`[direct-store] ✅ Added status ${status.id} to index. Total: ${statusIds.length} (verified on attempt ${verifyAttempt})`);
                  break;
                } else {
                  console.warn(`[direct-store] Status ${status.id} not found in index after save (attempt ${verifyAttempt}). Index contains:`, verifyParsed);
                }
              } else {
                console.warn(`[direct-store] Status index is not an array after save (attempt ${verifyAttempt}). Type:`, typeof verifyParsed, 'Value:', verifyParsed);
              }
            } catch (verifyErr) {
              console.warn(`[direct-store] Failed to parse status index during verification (attempt ${verifyAttempt}):`, verifyErr);
            }
          } else {
            console.warn(`[direct-store] Status index is null/undefined after save (attempt ${verifyAttempt})`);
          }
        }
        
        if (!added && retries > 1) {
          console.warn(`[direct-store] Status index verification failed, retrying... (${retries - 1} attempts left)`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 200));
        } else if (!added) {
          console.error(`[direct-store] ⚠️ CRITICAL: Failed to verify status index after ${retries} attempts for status ${status.id}`);
          // Не кидаємо помилку - статус збережено, просто індекс не оновився
          retries = 0;
        }
      } else {
        added = true;
        console.log(`[direct-store] ℹ️ Status ${status.id} already in index`);
      }
    }
    
    if (!added) {
      console.error(`[direct-store] ⚠️ WARNING: Status ${status.id} saved but not verified in index`);
    }
  } catch (err) {
    console.error(`[direct-store] Failed to save status ${status.id}:`, err);
    throw err;
  }
}

/**
 * Видалити статус
 */
export async function deleteDirectStatus(id: string): Promise<void> {
  try {
    // Видаляємо статус
    await kvWrite.setRaw(directKeys.STATUS_ITEM(id), '');

    // Видаляємо з індексу
    const indexData = await kvRead.getRaw(directKeys.STATUS_INDEX);
    if (indexData) {
      try {
        const parsed = unwrapKVResponse(indexData);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((sid) => sid !== id);
          await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify(filtered));
        }
      } catch (err) {
        console.warn('[direct-store] Failed to parse index when deleting status:', err);
      }
    }
  } catch (err) {
    console.error(`[direct-store] Failed to delete status ${id}:`, err);
    throw err;
  }
}

/**
 * Ініціалізувати початкові статуси
 * ВАЖЛИВО: Не викликає getAllDirectStatuses, щоб уникнути рекурсії
 */
export async function initializeDefaultStatuses(): Promise<void> {
  const defaultStatuses: Omit<DirectStatus, 'createdAt'>[] = [
    { id: 'new', name: 'Новий', color: '#3b82f6', order: 1, isDefault: true },
    { id: 'consultation', name: 'Консультація', color: '#fbbf24', order: 2, isDefault: false },
    { id: 'visited', name: 'Прийшов в салон', color: '#10b981', order: 3, isDefault: false },
    { id: 'paid-service', name: 'Записався на послугу', color: '#059669', order: 4, isDefault: false },
    { id: 'cancelled', name: 'Відмінив', color: '#ef4444', order: 5, isDefault: false },
    { id: 'rescheduled', name: 'Перенесено', color: '#f97316', order: 6, isDefault: false },
    { id: 'no-response', name: 'Не відповідає', color: '#6b7280', order: 7, isDefault: false },
  ];

  // Читаємо індекс напряму, без виклику getAllDirectStatuses
  const indexData = await kvRead.getRaw(directKeys.STATUS_INDEX);
  let existingIds = new Set<string>();
  
  if (indexData) {
    try {
      // Рекурсивно розгортаємо обгортки
      const parsed = unwrapKVResponse(indexData);
      if (Array.isArray(parsed)) {
        existingIds = new Set(parsed.filter((id: any): id is string => typeof id === 'string'));
      }
    } catch (err) {
      // Ігноруємо помилки парсингу - просто створюємо всі статуси
    }
  }

  // Створюємо тільки ті статуси, яких немає
  for (const status of defaultStatuses) {
    if (!existingIds.has(status.id)) {
      const fullStatus: DirectStatus = {
        ...status,
        createdAt: new Date().toISOString(),
      };
      await saveDirectStatus(fullStatus);
    }
  }
}
