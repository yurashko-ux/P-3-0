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
  try {
    // Згідно з документацією Altegio API, для отримання списку клієнтів використовується POST endpoint
    // POST /company/{company_id}/clients з тілом запиту для фільтрації (може бути порожнім об'єктом)
    const url = `/company/${companyId}/clients`;
    
    // Створюємо POST запит з пустим тілом (або можна додати параметри фільтрації)
    const response = await altegioFetch<Client[] | { data?: Client[]; clients?: Client[]; items?: Client[] }>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
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
    
    // Обмежуємо кількість, якщо вказано
    if (limit && clients.length > limit) {
      clients = clients.slice(0, limit);
    }
    
    console.log(`[altegio/clients] Got ${clients.length} clients for company ${companyId}`);
    return clients;
  } catch (err) {
    console.error(`[altegio/clients] Failed to get clients for company ${companyId}:`, err);
    throw err;
  }
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

