// web/lib/altegio/companies.ts
import { altegioFetch } from './client';
import type { Company } from './types';

/**
 * Отримує список компаній (салонів)
 * @param filterById - Якщо вказано, поверне тільки компанію з цим ID (для фільтрації своєї філії)
 */
export async function getCompanies(filterById?: number | string): Promise<Company[]> {
  try {
    // Якщо вказано ID філії, спробуємо отримати конкретну компанію
    if (filterById) {
      const companyId = typeof filterById === 'string' ? parseInt(filterById, 10) : filterById;
      if (!isNaN(companyId)) {
        try {
          const company = await getCompany(companyId);
          return company ? [company] : [];
        } catch (err) {
          console.warn(`[altegio/companies] Failed to get specific company ${companyId}, falling back to list:`, err);
          // Якщо не вдалося отримати конкретну компанію, повертаємося до списку
        }
      }
    }
    
    const response = await altegioFetch<Company[] | { data?: Company[] }>('/companies');
    
    // Alteg.io може повертати дані в різних форматах
    let companies: Company[] = [];
    if (Array.isArray(response)) {
      companies = response;
    } else if (response && typeof response === 'object' && 'data' in response) {
      companies = response.data || [];
    }
    
    // Якщо вказано ID для фільтрації, фільтруємо результат
    if (filterById && companies.length > 0) {
      const filterId = typeof filterById === 'string' ? filterById : String(filterById);
      const filtered = companies.filter((c: any) => {
        const id = String(c.id || c.company_id || '');
        return id === filterId || id === String(filterById);
      });
      
      // Якщо знайшли компанію за ID, повертаємо тільки її
      if (filtered.length > 0) {
        console.log(`[altegio/companies] Filtered companies by ID ${filterById}: found ${filtered.length} out of ${companies.length}`);
        return filtered;
      }
      
      // Якщо не знайшли за ID, може Partner ID - це не ID компанії
      console.warn(`[altegio/companies] Company with ID ${filterById} not found in list. Total companies: ${companies.length}`);
    }
    
    return companies;
  } catch (err) {
    console.error('[altegio/companies] Failed to get companies:', err);
    throw err;
  }
}

/**
 * Отримує інформацію про конкретну компанію
 */
export async function getCompany(companyId: number): Promise<Company | null> {
  try {
    const response = await altegioFetch<Company | { data?: Company }>(`/company/${companyId}`);
    
    if (response && typeof response === 'object') {
      if ('id' in response) {
        return response as Company;
      }
      if ('data' in response && response.data) {
        return response.data as Company;
      }
    }
    
    return null;
  } catch (err) {
    console.error(`[altegio/companies] Failed to get company ${companyId}:`, err);
    return null;
  }
}

