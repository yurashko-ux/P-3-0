// web/lib/direct-store.ts
// Функції для роботи з Direct клієнтами та статусами в KV

import { kvRead, kvWrite, directKeys } from './kv';
import type { DirectClient, DirectStatus } from './direct-types';

/**
 * Отримати всіх клієнтів
 */
export async function getAllDirectClients(): Promise<DirectClient[]> {
  try {
    console.log('[direct-store] getAllDirectClients: Starting to fetch clients');
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    if (!indexData) {
      console.log('[direct-store] No client index found, returning empty array');
      return [];
    }

    console.log('[direct-store] Index data retrieved:', {
      type: typeof indexData,
      isString: typeof indexData === 'string',
      length: typeof indexData === 'string' ? indexData.length : 'N/A',
    });

    let clientIds: string[] = [];
    try {
      // kvGetRaw може повернути вже розпарсений JSON або рядок
      let parsed: any;
      if (typeof indexData === 'string') {
        parsed = JSON.parse(indexData);
      } else {
        parsed = indexData;
      }
      
      console.log('[direct-store] Parsed index data:', {
        type: typeof parsed,
        isArray: Array.isArray(parsed),
        isObject: typeof parsed === 'object' && parsed !== null,
        value: Array.isArray(parsed) ? `Array(${parsed.length})` : String(parsed).slice(0, 100),
      });
      
      // Перевіряємо, чи це масив
      if (Array.isArray(parsed)) {
        clientIds = parsed;
        console.log(`[direct-store] Found ${clientIds.length} client IDs in index`);
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Якщо це об'єкт, спробуємо витягти масив з нього або скинути
        console.warn('[direct-store] Index data is an object, not array. Attempting to repair...');
        
        // Спробуємо знайти клієнтів через Instagram index перед скиданням
        // Це допоможе не втратити дані
        try {
          // Перевіряємо відомий тестовий username
          const testUsername = 'mykolayyurashko';
          const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(testUsername));
          if (idData) {
            const id = typeof idData === 'string' ? JSON.parse(idData) : idData;
            if (typeof id === 'string' && id.startsWith('direct_')) {
              // Знайшли хоча б одного клієнта - відновлюємо індекс
              await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify([id]));
              console.log('[direct-store] Repaired index with found client:', id);
              // Продовжуємо з відновленим індексом
              return getAllDirectClients();
            }
          }
        } catch (repairErr) {
          console.warn('[direct-store] Failed to repair index:', repairErr);
        }
        
        // Якщо не вдалося відновити, скидаємо індекс
        await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify([]));
        return [];
      } else if (typeof parsed === 'string') {
        // Якщо це просто рядок, спробуємо розпарсити ще раз
        try {
          const doubleParsed = JSON.parse(parsed);
          if (Array.isArray(doubleParsed)) {
            clientIds = doubleParsed;
          } else {
            console.warn('[direct-store] Double-parsed index is not an array');
            return [];
          }
        } catch {
          console.warn('[direct-store] Invalid index data format, expected array');
          return [];
        }
      } else {
        console.warn('[direct-store] Index data is not an array:', typeof parsed, parsed);
        return [];
      }
    } catch (parseErr) {
      console.error('[direct-store] Failed to parse index data:', parseErr);
      return [];
    }

    const clients: DirectClient[] = [];

    for (const id of clientIds) {
      if (!id || typeof id !== 'string') {
        console.warn(`[direct-store] Invalid client ID in index:`, id);
        continue;
      }
      
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
        if (clientData) {
          try {
            const client = JSON.parse(clientData);
            if (client && typeof client === 'object' && client.id) {
              clients.push(client);
            } else {
              console.warn(`[direct-store] Invalid client data for ${id}`);
            }
          } catch (err) {
            console.warn(`[direct-store] Failed to parse client ${id}:`, err);
          }
        }
      } catch (err) {
        console.warn(`[direct-store] Failed to read client ${id}:`, err);
      }
    }

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
    return JSON.parse(data);
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
    // Нормалізуємо username до нижнього регістру для пошуку
    const normalizedUsername = username.toLowerCase().trim();
    console.log(`[direct-store] Looking up client by Instagram username: ${normalizedUsername}`);
    
    const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(normalizedUsername));
    if (!idData) {
      console.log(`[direct-store] No client found for Instagram username: ${normalizedUsername}`);
      return null;
    }
    
    let id: string;
    if (typeof idData === 'string') {
      try {
        id = JSON.parse(idData);
      } catch {
        id = idData; // Якщо це вже рядок, використовуємо як є
      }
    } else {
      id = String(idData);
    }
    
    console.log(`[direct-store] Found client ID for Instagram ${normalizedUsername}: ${id}`);
    const client = await getDirectClient(id);
    console.log(`[direct-store] Retrieved client by ID ${id}:`, {
      found: !!client,
      username: client?.instagramUsername,
    });
    return client;
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
    console.log(`[direct-store] saveDirectClient called:`, {
      id: client.id,
      instagramUsername: client.instagramUsername,
      instagramUsernameType: typeof client.instagramUsername,
    });
    
    // Валідація обов'язкових полів
    if (!client.id) {
      throw new Error('Client ID is required');
    }
    if (!client.instagramUsername || typeof client.instagramUsername !== 'string') {
      throw new Error(`Client instagramUsername is required and must be a string, got: ${typeof client.instagramUsername}`);
    }

    // Нормалізуємо Instagram username до нижнього регістру
    const normalizedClient = {
      ...client,
      instagramUsername: client.instagramUsername.toLowerCase().trim(),
    };
    
    console.log(`[direct-store] Saving client to KV:`, {
      id: normalizedClient.id,
      instagramUsername: normalizedClient.instagramUsername,
    });

    // Зберігаємо клієнта
    await kvWrite.setRaw(directKeys.CLIENT_ITEM(normalizedClient.id), JSON.stringify(normalizedClient));
    console.log(`[direct-store] Client saved to KV successfully`);

    // Додаємо в індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let clientIds: string[] = [];
    
    if (indexData) {
      try {
        let parsed: any;
        if (typeof indexData === 'string') {
          parsed = JSON.parse(indexData);
        } else {
          parsed = indexData;
        }
        
        if (Array.isArray(parsed)) {
          clientIds = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          // Якщо індекс - об'єкт, скидаємо його
          console.warn('[direct-store] Client index is an object, resetting to array');
          clientIds = [];
        } else {
          console.warn('[direct-store] Client index is not an array, resetting');
          clientIds = [];
        }
      } catch (parseErr) {
        console.warn('[direct-store] Failed to parse client index, resetting:', parseErr);
        clientIds = [];
      }
    }
    
    // Гарантуємо, що це масив перед додаванням
    if (!Array.isArray(clientIds)) {
      console.warn('[direct-store] clientIds is not an array, creating new array');
      clientIds = [];
    }
    
    if (!clientIds.includes(normalizedClient.id)) {
      clientIds.push(normalizedClient.id);
      // Гарантуємо, що зберігаємо саме масив
      const indexToSave = JSON.stringify(clientIds);
      console.log(`[direct-store] Updating client index:`, {
        clientId: normalizedClient.id,
        totalClients: clientIds.length,
        indexPreview: clientIds.slice(0, 5),
      });
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexToSave);
      console.log(`[direct-store] Saved client ${normalizedClient.id} to index. Total clients: ${clientIds.length}`);
    } else {
      console.log(`[direct-store] Client ${normalizedClient.id} already in index`);
    }

    // Зберігаємо індекс по Instagram username для швидкого пошуку
    // Нормалізуємо username до нижнього регістру для консистентності
    const normalizedUsername = normalizedClient.instagramUsername.toLowerCase().trim();
    const instagramKey = directKeys.CLIENT_BY_INSTAGRAM(normalizedUsername);
    console.log(`[direct-store] Saving Instagram index: ${normalizedUsername} -> ${normalizedClient.id}`);
    await kvWrite.setRaw(instagramKey, JSON.stringify(normalizedClient.id));
    console.log(`[direct-store] Instagram index saved successfully`);
  } catch (err) {
    console.error(`[direct-store] Failed to save client ${client?.id || 'unknown'}:`, err);
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
      // Продовжуємо з новими даними
      return getAllDirectStatuses();
    }

    let statusIds: string[] = [];
    try {
      // kvGetRaw може повернути вже розпарсений JSON або рядок
      let parsed: any;
      if (typeof indexData === 'string') {
        parsed = JSON.parse(indexData);
      } else {
        parsed = indexData;
      }
      
      if (Array.isArray(parsed)) {
        statusIds = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Якщо це об'єкт, скидаємо індекс
        console.warn('[direct-store] Status index data is an object, not array. Resetting index.');
        await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify([]));
        // Ініціалізуємо початкові статуси
        await initializeDefaultStatuses();
        return getAllDirectStatuses();
      } else if (typeof parsed === 'string') {
        try {
          const doubleParsed = JSON.parse(parsed);
          if (Array.isArray(doubleParsed)) {
            statusIds = doubleParsed;
          } else {
            console.warn('[direct-store] Double-parsed status index is not an array');
            return [];
          }
        } catch {
          console.warn('[direct-store] Invalid status index data format');
          return [];
        }
      } else {
        console.warn('[direct-store] Status index data is not an array:', typeof parsed);
        return [];
      }
    } catch (parseErr) {
      console.error('[direct-store] Failed to parse status index data:', parseErr);
      return [];
    }

    const statuses: DirectStatus[] = [];

    for (const id of statusIds) {
      if (!id || typeof id !== 'string') {
        console.warn(`[direct-store] Invalid status ID in index:`, id);
        continue;
      }
      
      try {
        const statusData = await kvRead.getRaw(directKeys.STATUS_ITEM(id));
        if (statusData) {
          try {
            const status = JSON.parse(statusData);
            if (status && typeof status === 'object' && status.id) {
              statuses.push(status);
            } else {
              console.warn(`[direct-store] Invalid status data for ${id}`);
            }
          } catch (err) {
            console.warn(`[direct-store] Failed to parse status ${id}:`, err);
          }
        }
      } catch (err) {
        console.warn(`[direct-store] Failed to read status ${id}:`, err);
      }
    }

    // Сортуємо по order
    return statuses.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.error('[direct-store] Failed to get all statuses:', err);
    return [];
  }
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
    // Зберігаємо статус
    await kvWrite.setRaw(directKeys.STATUS_ITEM(status.id), JSON.stringify(status));

    // Додаємо в індекс
    const indexData = await kvRead.getRaw(directKeys.STATUS_INDEX);
    let statusIds: string[] = [];
    
    if (indexData) {
      try {
        const parsed = JSON.parse(indexData);
        if (Array.isArray(parsed)) {
          statusIds = parsed;
        } else {
          console.warn('[direct-store] Status index is not an array, resetting');
          statusIds = [];
        }
      } catch (parseErr) {
        console.warn('[direct-store] Failed to parse status index, resetting:', parseErr);
        statusIds = [];
      }
    }
    
    if (!statusIds.includes(status.id)) {
      statusIds.push(status.id);
      await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify(statusIds));
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
      const statusIds: string[] = JSON.parse(indexData);
      const filtered = statusIds.filter((sid) => sid !== id);
      await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify(filtered));
    }
  } catch (err) {
    console.error(`[direct-store] Failed to delete status ${id}:`, err);
    throw err;
  }
}

/**
 * Ініціалізувати початкові статуси
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

  const existingStatuses = await getAllDirectStatuses();
  const existingIds = new Set(existingStatuses.map((s) => s.id));

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
