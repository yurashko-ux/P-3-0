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

    const clientIds: string[] = JSON.parse(indexData);
    const clients: DirectClient[] = [];

    for (const id of clientIds) {
      const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
      if (clientData) {
        try {
          clients.push(JSON.parse(clientData));
        } catch (err) {
          console.warn(`[direct-store] Failed to parse client ${id}:`, err);
        }
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

    // Додаємо в індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    const clientIds: string[] = indexData ? JSON.parse(indexData) : [];
    if (!clientIds.includes(client.id)) {
      clientIds.push(client.id);
      await kvWrite.setRaw(directKeys.CLIENT_INDEX, JSON.stringify(clientIds));
    }

    // Зберігаємо індекс по Instagram username для швидкого пошуку
    // Нормалізуємо username до нижнього регістру для консистентності
    const normalizedUsername = client.instagramUsername.toLowerCase().trim();
    await kvWrite.setRaw(
      directKeys.CLIENT_BY_INSTAGRAM(normalizedUsername),
      JSON.stringify(client.id)
    );
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
      // Продовжуємо з новими даними
      return getAllDirectStatuses();
    }

    // Обробляємо різні формати даних
    let parsed: any;
    if (typeof indexData === 'string') {
      parsed = JSON.parse(indexData);
    } else {
      parsed = indexData;
    }
    
    // Перевіряємо, чи це масив
    if (!Array.isArray(parsed)) {
      // Якщо індекс пошкоджений (об'єкт замість масиву), скидаємо його
      console.warn('[direct-store] Status index data is an object, not array. Resetting index.');
      await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify([]));
      // Ініціалізуємо початкові статуси
      await initializeDefaultStatuses();
      // Повертаємо статуси без рекурсії
      const indexDataAfterInit = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (!indexDataAfterInit) return [];
      const newParsed = typeof indexDataAfterInit === 'string' ? JSON.parse(indexDataAfterInit) : indexDataAfterInit;
      if (!Array.isArray(newParsed)) return [];
      parsed = newParsed;
    }

    const statusIds: string[] = parsed;
    const statuses: DirectStatus[] = [];

    for (const id of statusIds) {
      const statusData = await kvRead.getRaw(directKeys.STATUS_ITEM(id));
      if (statusData) {
        try {
          statuses.push(JSON.parse(statusData));
        } catch (err) {
          console.warn(`[direct-store] Failed to parse status ${id}:`, err);
        }
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
    const statusIds: string[] = indexData ? JSON.parse(indexData) : [];
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
