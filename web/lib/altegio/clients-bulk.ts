// web/lib/altegio/clients-bulk.ts
// Функції для масового отримання даних клієнтів з Altegio API

import { altegioFetch } from './altegio-fetch';
import { altegioUrl, altegioHeaders } from './env';
import type { Client } from './types';

/**
 * Отримує дані про spent та visits для масиву клієнтів через POST /company/{id}/clients/search
 * 
 * @param companyId - ID компанії (location_id)
 * @param clientIds - Масив ID клієнтів
 * @returns Мапа clientId -> { spent, visits }
 */
export async function getClientsSpentVisitsBulk(
  companyId: number,
  clientIds: number[]
): Promise<Map<number, { spent: number | null; visits: number | null }>> {
  const result = new Map<number, { spent: number | null; visits: number | null }>();
  
  if (clientIds.length === 0) {
    return result;
  }

  try {
    // Спробуємо отримати дані через POST /company/{id}/clients/search
    // з фільтром по масиву ID та полями spent та visits
    const url = altegioUrl(`/company/${companyId}/clients/search`);
    const headers = altegioHeaders();
    
    // Розбиваємо на батчі по 50 клієнтів (якщо API має обмеження)
    const batchSize = 50;
    const batches: number[][] = [];
    
    for (let i = 0; i < clientIds.length; i += batchSize) {
      batches.push(clientIds.slice(i, i + batchSize));
    }

    console.log(`[altegio/clients-bulk] Processing ${clientIds.length} clients in ${batches.length} batches`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      try {
        // Варіант 1: Фільтр по масиву ID (якщо підтримується)
        const body = JSON.stringify({
          filters: [
            {
              field: 'id',
              operation: 'in',
              value: batch,
            },
          ],
          fields: [
            'id',
            'spent',
            'visits',
          ],
        });

        console.log(`[altegio/clients-bulk] Batch ${batchIndex + 1}/${batches.length}: Requesting ${batch.length} clients...`);
        
        const response = await altegioFetch<{
          success?: boolean;
          data?: Client[];
          clients?: Client[];
        }>(`/company/${companyId}/clients/search`, {
          method: 'POST',
          headers,
          body,
        });

        // Обробляємо відповідь
        let clients: Client[] = [];
        
        if (response && typeof response === 'object') {
          if (Array.isArray(response)) {
            clients = response;
          } else if (Array.isArray(response.data)) {
            clients = response.data;
          } else if (Array.isArray(response.clients)) {
            clients = response.clients;
          }
        }

        console.log(`[altegio/clients-bulk] Batch ${batchIndex + 1}: Received ${clients.length} clients`);

        // Зберігаємо дані
        for (const client of clients) {
          if (client.id) {
            result.set(client.id, {
              spent: client.spent ?? null,
              visits: client.visits ?? null,
            });
          }
        }

        // Невелика затримка між батчами, щоб не перевантажити API
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (err) {
        console.error(`[altegio/clients-bulk] Error processing batch ${batchIndex + 1}:`, err);
        // Продовжуємо з наступним батчем
        continue;
      }
    }

    console.log(`[altegio/clients-bulk] ✅ Processed ${result.size} clients out of ${clientIds.length} requested`);
    
    return result;
  } catch (error) {
    console.error('[altegio/clients-bulk] Error:', error);
    return result;
  }
}

/**
 * Альтернативний метод: отримує дані через GET /v1/client/{location_id}/{id} для кожного клієнта
 * з обмеженням на кількість одночасних запитів
 */
export async function getClientsSpentVisitsSequential(
  companyId: number,
  clientIds: number[],
  concurrency: number = 5
): Promise<Map<number, { spent: number | null; visits: number | null }>> {
  const result = new Map<number, { spent: number | null; visits: number | null }>();
  
  if (clientIds.length === 0) {
    return result;
  }

  console.log(`[altegio/clients-sequential] Processing ${clientIds.length} clients with concurrency ${concurrency}`);

  // Обробляємо клієнтів батчами з обмеженою конкурентністю
  for (let i = 0; i < clientIds.length; i += concurrency) {
    const batch = clientIds.slice(i, i + concurrency);
    
    const promises = batch.map(async (clientId) => {
      try {
        const url = altegioUrl(`/v1/client/${companyId}/${clientId}`);
        const headers = altegioHeaders();
        
        const response = await altegioFetch<{
          success?: boolean;
          data?: Client;
        }>(`/v1/client/${companyId}/${clientId}`, {
          method: 'GET',
          headers,
        });

        if (response && typeof response === 'object') {
          const client = 'data' in response && response.data ? response.data : response;
          
          if (client && client.id) {
            return {
              id: client.id,
              spent: client.spent ?? null,
              visits: client.visits ?? null,
            };
          }
        }
        
        return null;
      } catch (err) {
        console.warn(`[altegio/clients-sequential] Failed to get client ${clientId}:`, err);
        return null;
      }
    });

    const results = await Promise.all(promises);
    
    for (const data of results) {
      if (data) {
        result.set(data.id, {
          spent: data.spent,
          visits: data.visits,
        });
      }
    }

    // Невелика затримка між батчами
    if (i + concurrency < clientIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[altegio/clients-sequential] ✅ Processed ${result.size} clients out of ${clientIds.length} requested`);
  
  return result;
}
