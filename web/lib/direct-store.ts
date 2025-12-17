// web/lib/direct-store.ts
// Функції для роботи з Direct клієнтами та статусами в KV

import { kvRead, kvWrite, directKeys } from './kv';
import type { DirectClient, DirectStatus } from './direct-types';

/**
 * Отримати всіх клієнтів
 */
export async function getAllDirectClients(): Promise<DirectClient[]> {
  try {
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    if (!indexData) return [];

    let clientIds: string[] = [];
    try {
      const parsed = JSON.parse(indexData);
      // Перевіряємо, чи це масив
      if (Array.isArray(parsed)) {
        clientIds = parsed;
      } else if (typeof parsed === 'string') {
        // Якщо це просто рядок, спробуємо розпарсити ще раз
        try {
          clientIds = JSON.parse(parsed);
        } catch {
          // Якщо не вийшло, повертаємо порожній масив
          console.warn('[direct-store] Invalid index data format, expected array');
          return [];
        }
      } else {
        console.warn('[direct-store] Index data is not an array:', typeof parsed);
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
    const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(username));
    if (!idData) return null;
    const id = JSON.parse(idData);
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
    // Валідація обов'язкових полів
    if (!client.id) {
      throw new Error('Client ID is required');
    }
    if (!client.instagramUsername || typeof client.instagramUsername !== 'string') {
      throw new Error(`Client instagramUsername is required and must be a string, got: ${typeof client.instagramUsername}`);
    }

    // Зберігаємо клієнта
    await kvWrite.setRaw(directKeys.CLIENT_ITEM(client.id), JSON.stringify(client));

    // Додаємо в індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let clientIds: string[] = [];
    
    if (indexData) {
      try {
        const parsed = JSON.parse(indexData);
        if (Array.isArray(parsed)) {
          clientIds = parsed;
        } else {
          console.warn('[direct-store] Client index is not an array, resetting');
          clientIds = [];
        }
      } catch (parseErr) {
        console.warn('[direct-store] Failed to parse client index, resetting:', parseErr);
        clientIds = [];
      }
    }
    
    if (!clientIds.includes(client.id)) {
      clientIds.push(client.id);
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(clientIds));
    }

    // Зберігаємо індекс по Instagram username для швидкого пошуку
    const instagramKey = directKeys.CLIENT_BY_INSTAGRAM(client.instagramUsername);
    await kvWrite.setRaw(instagramKey, JSON.stringify(client.id));
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
    if (!indexData) return [];

    let statusIds: string[] = [];
    try {
      const parsed = JSON.parse(indexData);
      if (Array.isArray(parsed)) {
        statusIds = parsed;
      } else if (typeof parsed === 'string') {
        try {
          statusIds = JSON.parse(parsed);
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
