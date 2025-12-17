// web/lib/altegio/clients.ts
// Функції для роботи з клієнтами Alteg.io API

import { altegioFetch } from './client';
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
        clientsWithNames: clients.filter(c => c.name && c.name.trim()).length,
        clientsWithPhones: clients.filter(c => c.phone && c.phone.trim()).length,
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
    // Спробуємо різні варіанти URL з параметрами для отримання всіх полів, включаючи custom_fields
    // Згідно з документацією: GET /company/{company_id}/client/{client_id}
    const attempts = [
      // Варіант 1: GET /company/{id}/client/{id} з explicit fields (згідно з документацією)
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields`,
      },
      // Варіант 2: GET з include[]=custom_fields
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}?include[]=custom_fields&with[]=custom_fields&fields[]=custom_fields`,
      },
      // Варіант 3: GET з усіма полями
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}?fields[]=*&include[]=*`,
      },
      // Варіант 4: GET /company/{id}/clients/{id} (альтернативний шлях)
      {
        method: 'GET' as const,
        url: `/company/${companyId}/clients/${clientId}?include[]=custom_fields`,
      },
      // Варіант 5: POST /clients/search з фільтром по client_id
      {
        method: 'POST' as const,
        url: `/company/${companyId}/clients/search`,
        body: JSON.stringify({
          filters: [{ field: 'id', operation: 'equals', value: clientId }],
          fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
        }),
      },
      // Варіант 6: GET без параметрів (fallback)
      {
        method: 'GET' as const,
        url: `/company/${companyId}/client/${clientId}`,
      },
    ];
    
    let lastError: Error | null = null;
    
    for (const attempt of attempts) {
      try {
        const options: RequestInit = {
          method: attempt.method,
        };
        
        if (attempt.body) {
          options.body = attempt.body;
        }
        
        const response = await altegioFetch<Client | { data?: Client }>(attempt.url, options);
        
        if (response && typeof response === 'object') {
          let client: Client | null = null;
          
          if ('id' in response) {
            client = response as Client;
          } else if ('data' in response && response.data) {
            client = response.data as Client;
          }
          
          if (client && client.id) {
            // Логуємо структуру для діагностики кастомних полів
            console.log(`[altegio/clients] Client ${clientId} structure from ${attempt.method} ${attempt.url}:`, {
              keys: Object.keys(client),
              hasCustomFields: 'custom_fields' in client,
              customFields: client.custom_fields || null,
              customFieldsKeys: client.custom_fields ? Object.keys(client.custom_fields) : [],
              hasInstagramField: Object.keys(client).some(key => 
                key.toLowerCase().includes('instagram')
              ),
              fullResponse: JSON.stringify(client, null, 2).substring(0, 500), // Перші 500 символів для діагностики
            });
            
            // Якщо отримали custom_fields, повертаємо клієнта
            if (client.custom_fields) {
              console.log(`[altegio/clients] ✅ Got custom_fields for client ${clientId} using ${attempt.method} ${attempt.url}:`, Object.keys(client.custom_fields));
              return client;
            }
            
            // Якщо не отримали custom_fields, продовжуємо спроби з іншими URL
            console.log(`[altegio/clients] ⚠️ No custom_fields in response from ${attempt.method} ${attempt.url}, trying next...`);
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue; // Пробуємо наступний URL
      }
    }
    
    if (lastError) {
      console.error(`[altegio/clients] All attempts failed for client ${clientId}:`, lastError);
    }
    
    return null;
  } catch (err) {
    console.error(`[altegio/clients] Failed to get client ${clientId} for company ${companyId}:`, err);
    return null;
  }
}

