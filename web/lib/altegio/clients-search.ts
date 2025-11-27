// web/lib/altegio/clients-search.ts
// Функції для пошуку клієнтів з пагінацією

import { altegioFetch } from './client';
import type { Client } from './types';
import { altegioUrl } from './env';

/**
 * Отримує клієнтів з пагінацією через search endpoint
 * @param companyId - ID компанії
 * @param page - Номер сторінки (починається з 1)
 * @param pageSize - Розмір сторінки
 */
export async function getClientsPaginated(
  companyId: number,
  page: number = 1,
  pageSize: number = 100
): Promise<{ clients: Client[]; hasMore: boolean }> {
  try {
    const url = `/company/${companyId}/clients/search`;
    const body = JSON.stringify({
      page,
      page_size: pageSize,
      fields: ['id', 'name', 'phone', 'email', 'custom_fields', 'card_number', 'note'],
      order_by: 'last_visit_date',
      order_by_direction: 'desc',
    });

    const response = await altegioFetch<
      Client[] | 
      { data?: Client[]; clients?: Client[]; items?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } }
    >(url, {
      method: 'POST',
      body,
    });

    let clients: Client[] = [];
    let hasMore = false;

    // Парсимо відповідь
    if (Array.isArray(response)) {
      clients = response;
      hasMore = clients.length >= pageSize;
    } else if (response && typeof response === 'object') {
      if ('data' in response && Array.isArray(response.data)) {
        clients = response.data;
        hasMore = clients.length >= pageSize;
      } else if ('clients' in response && Array.isArray(response.clients)) {
        clients = response.clients;
        hasMore = clients.length >= pageSize;
      } else if ('items' in response && Array.isArray(response.items)) {
        clients = response.items;
        hasMore = clients.length >= pageSize;
      }

      // Перевіряємо meta для точного визначення hasMore
      if ('meta' in response && response.meta) {
        const meta = response.meta;
        if (meta.total_count !== undefined && meta.page !== undefined && meta.page_size !== undefined) {
          const totalPages = Math.ceil(meta.total_count / meta.page_size);
          hasMore = meta.page < totalPages;
        }
      }
    }

    console.log(`[altegio/clients-search] Page ${page}: got ${clients.length} clients, hasMore: ${hasMore}`);

    return { clients, hasMore };
  } catch (err) {
    console.error(`[altegio/clients-search] Failed to get clients page ${page}:`, err);
    throw err;
  }
}

/**
 * Отримує всіх клієнтів з пагінацією до вказаного ліміту
 * @param companyId - ID компанії
 * @param maxClients - Максимальна кількість клієнтів для отримання
 * @param pageSize - Розмір сторінки (за замовчуванням 100)
 */
export async function getAllClientsPaginated(
  companyId: number,
  maxClients: number = 1000,
  pageSize: number = 100
): Promise<Client[]> {
  const allClients: Client[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (allClients.length < maxClients && hasMore) {
    try {
      const { clients, hasMore: hasMorePages } = await getClientsPaginated(companyId, currentPage, pageSize);

      if (clients.length === 0) {
        hasMore = false;
        break;
      }

      // Додаємо клієнтів без дублювання
      const existingIds = new Set(allClients.map(c => c.id));
      const newClients = clients.filter(c => !existingIds.has(c.id));
      allClients.push(...newClients);

      console.log(`[altegio/clients-search] Total clients so far: ${allClients.length}`);

      // Перевіряємо, чи є ще сторінки
      hasMore = hasMorePages && allClients.length < maxClients;
      currentPage++;

      // Невелика затримка між запитами
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error(`[altegio/clients-search] Error on page ${currentPage}:`, err);
      hasMore = false;
      break;
    }
  }

  return allClients.slice(0, maxClients);
}

