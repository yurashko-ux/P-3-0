// web/lib/altegio/clients.ts
// Функції для роботи з клієнтами Alteg.io API

import { appendFileSync } from 'fs';
import { join } from 'path';
import { altegioFetch } from './client';

const DEBUG_LOG = join(process.cwd(), '..', '.cursor', 'debug.log');
function debugLog(data: Record<string, unknown>) {
  try { appendFileSync(DEBUG_LOG, JSON.stringify(data) + '\n'); } catch {}
}
import type { Client } from './types';

/**
 * Отримує список клієнтів компанії
 * @param companyId - ID компанії (філії/салону)
 * @param limit - Максимальна кількість клієнтів для отримання (опціонально)
 */
export async function getClients(companyId: number, limit?: number): Promise<Client[]> {
  const url = `/company/${companyId}/clients`;
  
  // Згідно з документацією Altegio API (https://developer.alteg.io/api):
  // "postGet a list of clients" - використовує POST метод (GET deprecated)
  // Спробуємо різні варіанти endpoint згідно з документацією
  const attempts = [
    // Варіант 1: POST /company/{id}/clients/search з fields включаючи custom_fields (згідно з документацією)
    {
      name: 'POST /company/{id}/clients/search with custom_fields',
      method: 'POST' as const,
      url: `/company/${companyId}/clients/search`,
      body: JSON.stringify({
        page: 1,
        page_size: limit || 10,
        fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
        order_by: 'last_visit_date',
        order_by_direction: 'desc',
      }),
    },
    // Варіант 2: POST /company/{id}/clients/search без fields (поверне всі поля)
    {
      name: 'POST /company/{id}/clients/search without fields (all fields)',
      method: 'POST' as const,
      url: `/company/${companyId}/clients/search`,
      body: JSON.stringify({
        page: 1,
        page_size: limit || 10,
        order_by: 'last_visit_date',
        order_by_direction: 'desc',
      }),
    },
    // Варіант 3: POST /company/{id}/clients (старий endpoint - fallback)
    {
      name: 'POST /company/{id}/clients with custom_fields (fallback)',
      method: 'POST' as const,
      url: `/company/${companyId}/clients?include[]=custom_fields&with[]=custom_fields&fields[]=custom_fields`,
      body: JSON.stringify({
        ...(limit ? { limit } : {}),
        include: ['custom_fields'],
        with: ['custom_fields'],
      }),
    },
    // Варіант 2: POST /company/{id}/clients з параметрами fields та include (спробуємо отримати всі поля)
    {
      name: 'POST /company/{id}/clients with fields and include',
      method: 'POST' as const,
      url: `/company/${companyId}/clients?fields[]=*&include[]=*&with[]=*`,
      body: JSON.stringify({
        ...(limit ? { limit } : {}),
      }),
    },
    // Варіант 2: POST /company/{id}/clients з параметрами в body
    {
      name: 'POST /company/{id}/clients with fields in body',
      method: 'POST' as const,
      url: `/company/${companyId}/clients`,
      body: JSON.stringify({
        fields: ['*'],
        include: ['*'],
        with: ['*'],
        ...(limit ? { limit } : {}),
      }),
    },
    // Варіант 3: POST /company/{id}/clients з explicit fields list
    {
      name: 'POST /company/{id}/clients with explicit fields',
      method: 'POST' as const,
      url: `/company/${companyId}/clients`,
      body: JSON.stringify({
        fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
        include: ['custom_fields'],
        ...(limit ? { limit } : {}),
      }),
    },
    // Варіант 4: POST /company/{id}/clients з query параметрами для полів
    {
      name: 'POST /company/{id}/clients with query fields',
      method: 'POST' as const,
      url: `/company/${companyId}/clients?fields=id,name,phone,email,custom_fields&include[]=custom_fields`,
      body: JSON.stringify({
        ...(limit ? { limit } : {}),
      }),
    },
    // Варіант 5: POST /company/{id}/clients з пустим тілом (fallback - працює, але повертає тільки ID)
    {
      name: 'POST /company/{id}/clients (fallback - IDs only)',
      method: 'POST' as const,
      url: `/company/${companyId}/clients`,
      body: JSON.stringify({}),
    },
    // Варіант 5: POST /clients з пустим тілом (може працювати якщо company_id береться з токена)
    {
      name: 'POST /clients empty body',
      method: 'POST' as const,
      url: `/clients`,
      body: JSON.stringify({}),
    },
    // Варіант 6: POST /company/{id}/clients з параметрами пагінації
    {
      name: 'POST /company/{id}/clients with pagination',
      method: 'POST' as const,
      url: `/company/${companyId}/clients`,
      body: JSON.stringify({ page: 1, per_page: limit || 100 }),
    },
  ];
  
  let lastError: Error | null = null;
  
  for (const attempt of attempts) {
    try {
      console.log(`[altegio/clients] Trying ${attempt.name} for company ${companyId}...`);
      
      const options: RequestInit = {
        method: attempt.method,
      };
      
      if (attempt.body) {
        options.body = attempt.body;
      } else if (attempt.body === undefined && attempt.method === 'POST') {
        // Якщо method POST, але body не вказано, використовуємо пусте тіло
        options.body = JSON.stringify({});
      }
      
      const response = await altegioFetch<Client[] | { data?: Client[]; clients?: Client[]; items?: Client[] }>(
        attempt.url,
        options
      );
      
      // Детальне логування для діагностики
      let clients: Client[] = [];
      
      // Логуємо повну структуру відповіді для діагностики
      console.log(`[altegio/clients] Raw response structure from ${attempt.name}:`, {
        isArray: Array.isArray(response),
        responseType: typeof response,
        responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
        responseSample: JSON.stringify(response).substring(0, 500), // Перші 500 символів
      });
      
      if (Array.isArray(response)) {
        clients = response;
      } else if (response && typeof response === 'object') {
        // Для /clients/search може бути структура { data: [...], meta: {...} }
        if ('data' in response && Array.isArray(response.data)) {
          clients = response.data;
        } else if ('clients' in response && Array.isArray(response.clients)) {
          clients = response.clients;
        } else if ('items' in response && Array.isArray(response.items)) {
          clients = response.items;
        } else if ('results' in response && Array.isArray(response.results)) {
          clients = response.results;
        }
      }
      
      console.log(`[altegio/clients] Response from ${attempt.name}:`, {
        isArray: Array.isArray(response),
        responseType: typeof response,
        responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
        clientsCount: clients.length,
        firstClientKeys: clients[0] ? Object.keys(clients[0]) : [],
        firstClientSample: clients[0] || null,
        // Перевіряємо, чи клієнти мають хоча б ім'я або телефон
        clientsWithNames: clients.filter(c => c.name && typeof c.name === 'string' && c.name.trim()).length,
        clientsWithPhones: clients.filter(c => c.phone && (typeof c.phone === 'string' ? c.phone.trim() : String(c.phone))).length,
        clientsWithOnlyId: clients.filter(c => Object.keys(c).length === 1 && 'id' in c).length,
      });
      
      // Якщо отримали порожній список, продовжуємо спроби
      if (clients.length === 0) {
        continue;
      }
      
      // Фільтруємо видалених/неактивних клієнтів (якщо є поле deleted_at або active)
      const activeClients = clients.filter((client: any) => {
        // Пропускаємо клієнтів, які мають deleted_at
        if (client.deleted_at) {
          return false;
        }
        // Пропускаємо неактивних клієнтів
        if (client.active === false || client.active === 0) {
          return false;
        }
        return true;
      });
      
      if (activeClients.length < clients.length) {
        console.log(`[altegio/clients] Filtered ${clients.length - activeClients.length} inactive/deleted clients`);
        clients = activeClients;
      }
      
      // Якщо отримали клієнтів, перевіряємо чи є повна інформація
      if (clients.length > 0) {
        // Обмежуємо кількість, якщо вказано
        if (limit && clients.length > limit) {
          clients = clients.slice(0, limit);
        }
        
        // Перевіряємо, чи є повна інформація про клієнтів (не тільки ID)
        const firstClient = clients[0];
        const hasOnlyIds = clients.length > 0 && clients.every((c: any) => {
          // Перевіряємо, чи об'єкт має тільки поле 'id' або тільки числові ID
          const keys = Object.keys(c);
          return keys.length === 1 && keys[0] === 'id' && typeof c.id === 'number';
        });
        
        const hasFullInfo = firstClient && (
          firstClient.name !== undefined || 
          firstClient.phone !== undefined || 
          (Object.keys(firstClient).length > 1 && !hasOnlyIds)
        );
        
        console.log(`[altegio/clients] ✅ Got ${clients.length} clients using ${attempt.name}`, {
          hasFullInfo,
          hasOnlyIds,
          firstClientKeys: firstClient ? Object.keys(firstClient) : [],
          firstClientSample: firstClient,
        });
        
        // Якщо отримали тільки ID, спробуємо отримати повну інформацію через окремі запити
        if (hasOnlyIds && clients.length > 0) {
          console.log(`[altegio/clients] ⚠️ Only IDs received, fetching full client details for ${clients.length} clients...`);
          const clientsWithFullInfo: Client[] = [];
          let skippedCount = 0;
          
          for (const client of clients.slice(0, limit || 10)) {
            try {
              const fullClient = await getClient(companyId, client.id);
              if (fullClient) {
                // Перевіряємо, чи клієнт має хоч якісь дані (ім'я, телефон, email)
                const hasAnyData = fullClient.name || fullClient.phone || fullClient.email;
                if (hasAnyData) {
                  clientsWithFullInfo.push(fullClient);
                  console.log(`[altegio/clients] ✅ Got full info for client ${client.id}: name="${fullClient.name || 'none'}", phone="${fullClient.phone || 'none'}"`);
                } else {
                  skippedCount++;
                  console.log(`[altegio/clients] ⚠️ Client ${client.id} has no data (no name, phone, email) - skipping`);
                }
              } else {
                skippedCount++;
                console.log(`[altegio/clients] ⚠️ Client ${client.id} not found or has no data - skipping`);
              }
            } catch (err) {
              skippedCount++;
              console.warn(`[altegio/clients] Failed to get full info for client ${client.id}:`, err);
            }
            
            // Невелика затримка, щоб не перевантажити API
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          console.log(`[altegio/clients] Summary: ${clientsWithFullInfo.length} clients with data, ${skippedCount} skipped (no data or not found)`);
          
          if (clientsWithFullInfo.length === 0) {
            console.warn(`[altegio/clients] ⚠️ No clients with data found! All ${clients.length} clients appear to be deleted/inactive or have no data.`);
            // Продовжуємо спроби з іншими методами
            continue;
          }
          
          return clientsWithFullInfo;
        }
        
        // Якщо є повна інформація, повертаємо клієнтів
        if (hasFullInfo) {
          return clients;
        }
        
        // Якщо ні повної інформації, ні тільки ID, продовжуємо спроби
        continue;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`[altegio/clients] ❌ ${attempt.name} failed:`, errorMessage);
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Якщо це помилка прав доступу, продовжуємо спроби
      if (errorMessage.includes('403') || errorMessage.includes('No company management rights')) {
        continue;
      }
      
      // Для інших помилок (крім прав доступу) продовжуємо спроби
      continue;
    }
  }
  
  // Якщо всі спроби не вдалися, спробуємо отримати клієнтів через appointments
  if (lastError) {
    console.warn(`[altegio/clients] All direct attempts failed for company ${companyId}, trying to get clients via appointments...`);
    
    try {
      // Спробуємо отримати клієнтів через appointments (обхідний шлях)
      const { getUpcomingAppointments } = await import('./appointments');
      const appointments = await getUpcomingAppointments(companyId, 90, true); // 90 днів для отримання більше клієнтів
      
      // Витягуємо унікальних клієнтів з appointments
      const clientsMap = new Map<number, Client>();
      
      for (const apt of appointments) {
        if (apt.client && apt.client.id) {
          const clientId = apt.client.id;
          if (!clientsMap.has(clientId)) {
            clientsMap.set(clientId, apt.client);
          }
        }
      }
      
      const clients = Array.from(clientsMap.values());
      
      if (clients.length > 0) {
        console.log(`[altegio/clients] ✅ Got ${clients.length} unique clients via appointments`);
        
        // Обмежуємо кількість, якщо вказано
        if (limit && clients.length > limit) {
          return clients.slice(0, limit);
        }
        
        return clients;
      }
      
      console.warn(`[altegio/clients] No clients found via appointments either`);
    } catch (appointmentsError) {
      console.error(`[altegio/clients] Failed to get clients via appointments:`, appointmentsError);
    }
    
    // Якщо і через appointments не вдалося, викидаємо оригінальну помилку
    console.error(`[altegio/clients] All attempts failed for company ${companyId}`);
    throw lastError;
  }
  
  // Якщо нічого не знайдено, повертаємо порожній масив
  console.log(`[altegio/clients] No clients found for company ${companyId}`);
  return [];
}

/**
 * Отримує інформацію про конкретного клієнта
 * @param companyId - ID компанії (філії/салону)
 * @param clientId - ID клієнта
 */
export async function getClient(companyId: number, clientId: number): Promise<Client | null> {
  try {
    // Спробуємо різні варіанти URL згідно з документацією Altegio API
    // Документація: https://developer.alteg.io/en
    // Base URL: https://api.alteg.io/api (v1 або v2)
    // Згідно з документацією: https://developer.alteg.io/en
    // Правильний endpoint: GET /v1/client/{location_id}/{id}
    // (БЕЗ /company/ в шляху!)
    // Відповідь містить: spent, visits, balance та інші поля
    const attempts = [
      // Варіант 1: Правильний формат згідно з документацією - GET /v1/client/{location_id}/{id}
      {
        method: 'GET' as const,
        url: `/v1/client/${companyId}/${clientId}`,
      },
      // Варіант 2: Без префіксу версії (якщо base URL вже містить /v1)
      {
        method: 'GET' as const,
        url: `/client/${companyId}/${clientId}`,
      },
      // Варіант 3: GET /company/{id}/client/{id} без параметрів (старий формат)
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}`,
      },
      // Варіант 4: GET /company/{id}/client/{id} з усіма полями
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}?fields[]=*&include[]=*`,
      },
      // Варіант 5: GET /company/{id}/client/{id} з explicit fields включаючи статистику
      // Altegio може повертати visits_count замість visits
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields&fields[]=spent&fields[]=visits&fields[]=visits_count&fields[]=success_visits_count&fields[]=balance`,
      },
      // Варіант 6: Альтернативний формат - GET /clients/{location_id}/{client_id}
      {
        method: 'GET' as const,
        url: `/clients/${companyId}/${clientId}`,
      },
      // Варіант 7: POST /company/{id}/clients/search з фільтром по client_id
      {
        method: 'POST' as const,
        url: `/company/${companyId}/clients/search`,
        body: JSON.stringify({
          filters: [{ field: 'id', operation: 'equals', value: clientId }],
          fields: [
            'id', 
            'name', 
            'phone', 
            'email', 
            'custom_fields',
            'spent',
            'visits',
            'visits_count',
            'success_visits_count',
            'balance',
            // Дата останнього візиту (щоб не робити окремий visits/search для одного клієнта)
            'last_visit_date',
          ],
        }),
      },
      // Варіант 8: POST /company/{id}/clients/search без fields (поверне всі поля)
      {
        method: 'POST' as const,
        url: `/company/${companyId}/clients/search`,
        body: JSON.stringify({
          filters: [{ field: 'id', operation: 'equals', value: clientId }],
        }),
      },
      // Варіант 9: Спробуємо з явною версією v2
      {
        method: 'GET' as const,
        url: `/v2/client/${companyId}/${clientId}`,
      },
    ];
    
    const errors: Array<{ url: string; method: string; error: string; status?: number }> = [];
    let lastError: Error | null = null;
    
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        console.log(`[altegio/clients] Attempt ${i + 1}/${attempts.length}: ${attempt.method} ${attempt.url}`);
        
        const options: RequestInit = {
          method: attempt.method,
        };
        
        if (attempt.body) {
          options.body = attempt.body;
        }
        
        const response = await altegioFetch<any>(attempt.url, options);
        
        console.log(`[altegio/clients] Response structure for attempt ${i + 1}:`, {
          hasSuccess: 'success' in response,
          hasData: 'data' in response,
          hasId: 'id' in response,
          responseKeys: Object.keys(response || {}),
          responseType: typeof response,
        });
        
        if (response && typeof response === 'object') {
          let client: Client | null = null;
          
          // Згідно з документацією, відповідь має формат: { success: true, data: {...}, meta: [] }
          if ('data' in response && response.data && typeof response.data === 'object') {
            client = response.data as Client;
            console.log(`[altegio/clients] ✅ Got client from response.data for attempt ${i + 1}, keys:`, Object.keys(client));
            console.log(`[altegio/clients] Client data preview:`, {
              id: client.id,
              name: client.name,
              spent: (client as any).spent,
              visits: (client as any).visits,
              balance: (client as any).balance,
            });
          } else if ('id' in response) {
            // Якщо відповідь - це сам клієнт (без обгортки)
            client = response as Client;
            console.log(`[altegio/clients] ✅ Got client directly from response for attempt ${i + 1}, keys:`, Object.keys(client));
          } else {
            console.log(`[altegio/clients] ⚠️ Attempt ${i + 1}: Response structure doesn't match expected format:`, {
              responseKeys: Object.keys(response),
              responsePreview: JSON.stringify(response).substring(0, 200),
            });
          }
          
          if (client && client.id) {
            // Логуємо структуру для діагностики, включаючи статистичні поля
            const allKeys = Object.keys(client);
            const visitRelatedKeys = allKeys.filter(key => 
              key.toLowerCase().includes('visit') || 
              key.toLowerCase().includes('візит')
            );
            const amountRelatedKeys = allKeys.filter(key => 
              key.toLowerCase().includes('amount') || 
              key.toLowerCase().includes('spent') || 
              key.toLowerCase().includes('total') ||
              key.toLowerCase().includes('сума')
            );
            
            console.log(`[altegio/clients] ✅ Client ${clientId} structure from ${attempt.method} ${attempt.url}:`, {
              keys: allKeys,
              hasCustomFields: 'custom_fields' in client,
              customFields: client.custom_fields || null,
              customFieldsKeys: client.custom_fields ? Object.keys(client.custom_fields) : [],
              hasInstagramField: allKeys.some(key => 
                key.toLowerCase().includes('instagram')
              ),
              // Статистичні поля
              visitRelatedKeys,
              visitRelatedValues: visitRelatedKeys.reduce((acc, key) => {
                acc[key] = (client as any)[key];
                return acc;
              }, {} as Record<string, any>),
              amountRelatedKeys,
              amountRelatedValues: amountRelatedKeys.reduce((acc, key) => {
                acc[key] = (client as any)[key];
                return acc;
              }, {} as Record<string, any>),
              // Повна відповідь (обмежена для логування)
              fullResponse: JSON.stringify(client, null, 2).substring(0, 1000),
            });
            
            // Повертаємо клієнта, якщо отримали хоча б якісь дані (не обов'язково custom_fields)
            // Це дозволяє отримати клієнтів, які мають інші поля (success_visits_count, total_spent тощо)
            console.log(`[altegio/clients] ✅ Got client ${clientId} using ${attempt.method} ${attempt.url}`);
            // #region agent log
            const vk = Object.keys(client).filter(k => k.toLowerCase().includes('visit'));
            const vv = vk.reduce((acc: Record<string, unknown>, k) => { acc[k] = (client as any)[k]; return acc; }, {});
            debugLog({ location: 'clients.ts:519', message: 'getClient visit fields', clientId, visitKeys: vk, visitValues: vv, visits: (client as any).visits, hypothesisId: 'D', timestamp: Date.now() });
            // #endregion
            return client;
          } else {
            console.log(`[altegio/clients] ⚠️ Attempt ${i + 1}: Response received but no client data (id missing or invalid)`);
          }
        } else {
          console.log(`[altegio/clients] ⚠️ Attempt ${i + 1}: Invalid response format`);
        }
      } catch (err: any) {
        const errorMessage = err.message || String(err);
        const status = err.status;
        lastError = err instanceof Error ? err : new Error(String(err));
        
        errors.push({
          url: attempt.url,
          method: attempt.method,
          error: errorMessage,
          status: status,
        });
        
        console.log(`[altegio/clients] ❌ Attempt ${i + 1}/${attempts.length} failed: ${attempt.method} ${attempt.url} - ${errorMessage} (status: ${status || 'unknown'})`);
        continue; // Пробуємо наступний URL
      }
    }
    
    if (lastError) {
      console.error(`[altegio/clients] ❌ All ${attempts.length} attempts failed for client ${clientId}:`, {
        totalAttempts: attempts.length,
        errors: errors.map(e => `${e.method} ${e.url}: ${e.error} (${e.status || 'no status'})`),
        lastError: lastError.message,
      });
    }
    
    return null;
  } catch (err) {
    console.error(`[altegio/clients] Failed to get client ${clientId} for company ${companyId}:`, err);
    return null;
  }
}

