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
  
  // Спробуємо різні варіанти endpoint та методів
  // Згідно з документацією Altegio API, можливі різні формати
  const attempts = [
    // Варіант 1: POST /company/{id}/clients з пустим тілом (стандартний для Altegio API v2)
    {
      name: 'POST /company/{id}/clients with empty body',
      method: 'POST' as const,
      url: url,
      body: JSON.stringify({}),
    },
    // Варіант 2: GET /clients (як для компаній - /companies)
    {
      name: 'GET /clients',
      method: 'GET' as const,
      url: `/clients`,
      body: undefined,
    },
    // Варіант 3: GET /clients з company_id в query параметрі
    {
      name: 'GET /clients?company_id={id}',
      method: 'GET' as const,
      url: `/clients?company_id=${companyId}`,
      body: undefined,
    },
    // Варіант 4: GET /company/{id}/clients (може працювати як GET /companies)
    {
      name: 'GET /company/{id}/clients',
      method: 'GET' as const,
      url: url,
      body: undefined,
    },
    // Варіант 5: POST /clients з company_id в тілі
    {
      name: 'POST /clients with company_id in body',
      method: 'POST' as const,
      url: `/clients`,
      body: JSON.stringify({ company_id: companyId }),
    },
    // Варіант 6: POST /company/{id}/clients з параметрами пагінації
    {
      name: 'POST /company/{id}/clients with pagination',
      method: 'POST' as const,
      url: url,
      body: JSON.stringify({ page: 1, per_page: limit || 100 }),
    },
    // Варіант 7: POST /company/{id}/clients з limit
    {
      name: 'POST /company/{id}/clients with limit',
      method: 'POST' as const,
      url: url,
      body: JSON.stringify({ limit: limit || 100 }),
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
      }
      
      const response = await altegioFetch<Client[] | { data?: Client[]; clients?: Client[]; items?: Client[] }>(
        attempt.url,
        options
      );
      
      let clients: Client[] = [];
      if (Array.isArray(response)) {
        clients = response;
      } else if (response && typeof response === 'object') {
        if ('data' in response && Array.isArray(response.data)) {
          clients = response.data;
        } else if ('clients' in response && Array.isArray(response.clients)) {
          clients = response.clients;
        } else if ('items' in response && Array.isArray(response.items)) {
          clients = response.items;
        }
      }
      
      // Якщо отримали клієнтів, повертаємо результат
      if (clients.length > 0 || attempt === attempts[attempts.length - 1]) {
        // Обмежуємо кількість, якщо вказано
        if (limit && clients.length > limit) {
          clients = clients.slice(0, limit);
        }
        
        console.log(`[altegio/clients] ✅ Got ${clients.length} clients using ${attempt.name}`);
        return clients;
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
  
  // Якщо всі спроби не вдалися
  if (lastError) {
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
    const url = `/company/${companyId}/client/${clientId}`;
    const response = await altegioFetch<Client | { data?: Client }>(url);
    
    if (response && typeof response === 'object') {
      if ('id' in response) {
        // Логуємо структуру для діагностики кастомних полів
        console.log(`[altegio/clients] Client ${clientId} structure:`, {
          keys: Object.keys(response),
          hasCustomFields: 'custom_fields' in response,
          hasInstagramField: Object.keys(response).some(key => 
            key.toLowerCase().includes('instagram')
          ),
        });
        return response as Client;
      }
      if ('data' in response && response.data) {
        return response.data as Client;
      }
    }
    
    return null;
  } catch (err) {
    console.error(`[altegio/clients] Failed to get client ${clientId} for company ${companyId}:`, err);
    return null;
  }
}

