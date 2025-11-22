// web/lib/altegio/companies.ts
import { altegioFetch } from './client';
import type { Company } from './types';

/**
 * Отримує список компаній (салонів)
 */
export async function getCompanies(): Promise<Company[]> {
  try {
    const response = await altegioFetch<Company[] | { data?: Company[] }>('/companies');
    
    // Alteg.io може повертати дані в різних форматах
    if (Array.isArray(response)) {
      return response;
    }
    
    if (response && typeof response === 'object' && 'data' in response) {
      return response.data || [];
    }
    
    return [];
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

