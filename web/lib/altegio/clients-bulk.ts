// web/lib/altegio/clients-bulk.ts
// Функції для масового отримання даних клієнтів з Altegio API

import { altegioFetch } from './client';
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
            'visits_count',
            'success_visits_count',
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

        // Зберігаємо дані (Altegio може повертати visits_count замість visits)
        for (const client of clients) {
          if (client.id) {
            const visits =
              (typeof (client as any).visits === 'number' ? (client as any).visits : null) ??
              (typeof (client as any).visits_count === 'number' ? (client as any).visits_count : null) ??
              (typeof (client as any).success_visits_count === 'number' ? (client as any).success_visits_count : null) ??
              null;
            result.set(client.id, {
              spent: (client as any).spent ?? (client as any).total_spent ?? null,
              visits,
            });
          }
        }

        // Затримка між батчами з дотриманням rate limit: 5 запитів/сек = 200мс між запитами
        // Але оскільки це батчі, робимо затримку 1 секунду між батчами для безпеки
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
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
 * з дотриманням rate limits: 200 запитів/хв, 5 запитів/сек
 * 
 * Обмеження:
 * - 200 запитів на хвилину на одну IP-адресу
 * - 5 запитів на секунду на одну IP-адресу
 * 
 * Стратегія: 4 запити/сек (залишаємо запас), ~120 запитів/хв (залишаємо запас)
 */
export async function getClientsSpentVisitsSequential(
  companyId: number,
  clientIds: number[],
  requestsPerSecond: number = 4 // 4 замість 5, щоб бути в безпеці
): Promise<Map<number, { spent: number | null; visits: number | null }>> {
  const result = new Map<number, { spent: number | null; visits: number | null }>();
  
  if (clientIds.length === 0) {
    return result;
  }

  console.log(`[altegio/clients-sequential] Processing ${clientIds.length} clients with rate limit: ${requestsPerSecond} requests/second`);

  const delayBetweenRequests = 1000 / requestsPerSecond; // мс між запитами (250мс для 4/сек)
  let requestCount = 0;
  const startTime = Date.now();

  // Обробляємо клієнтів послідовно з дотриманням rate limit
  for (let i = 0; i < clientIds.length; i++) {
    const clientId = clientIds[i];
    
    try {
      // Перевіряємо rate limit: якщо минула хвилина, скидаємо лічильник
      const elapsed = Date.now() - startTime;
      if (elapsed > 60000) {
        // Якщо минула хвилина, можна продовжувати (але все одно дотримуємось 5/сек)
        requestCount = 0;
      }

      const response = await altegioFetch<{
        success?: boolean;
        data?: Client;
      }>(`/v1/client/${companyId}/${clientId}`, {
        method: 'GET',
      });

      if (response && typeof response === 'object') {
        let client: Client | null = null;
        
        // Перевіряємо формат відповіді
        if ('data' in response && response.data) {
          client = response.data;
        } else if ('id' in response) {
          // Якщо відповідь - це сам клієнт
          client = response as Client;
        }
        
        if (client && client.id) {
          const visits =
            (typeof (client as any).visits === 'number' ? (client as any).visits : null) ??
            (typeof (client as any).visits_count === 'number' ? (client as any).visits_count : null) ??
            (typeof (client as any).success_visits_count === 'number' ? (client as any).success_visits_count : null) ??
            null;
          result.set(client.id, {
            spent: (client as any).spent ?? (client as any).total_spent ?? null,
            visits,
          });
          requestCount++;
        }
      }
    } catch (err) {
      console.warn(`[altegio/clients-sequential] Failed to get client ${clientId}:`, err);
      // Продовжуємо навіть при помилці
    }

    // Затримка між запитами для дотримання rate limit (крім останнього запиту)
    if (i < clientIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
  }

  console.log(`[altegio/clients-sequential] ✅ Processed ${result.size} clients out of ${clientIds.length} requested in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  
  return result;
}
