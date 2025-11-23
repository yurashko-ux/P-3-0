// web/lib/altegio/appointments.ts
// Функції для роботи з записами (appointments) Alteg.io API

import { altegioFetch } from './client';
import type { Appointment } from './types';

export type GetAppointmentsOptions = {
  dateFrom?: string; // Дата початку (ISO format або YYYY-MM-DD)
  dateTo?: string; // Дата кінця (ISO format або YYYY-MM-DD)
  status?: string; // Фільтр за статусом
  clientId?: number; // Фільтр за клієнтом
  staffId?: number; // Фільтр за майстром
  includeClient?: boolean; // Включити інформацію про клієнта
};

/**
 * Отримує записи з календаря компанії
 * @param companyId - ID компанії (філії/салону)
 * @param options - Опції фільтрації
 */
export async function getAppointments(
  companyId: number,
  options: GetAppointmentsOptions = {}
): Promise<Appointment[]> {
  try {
    const url = `/company/${companyId}/appointments`;
    
    // Формуємо параметри запиту
    const queryParams = new URLSearchParams();
    if (options.dateFrom) {
      queryParams.append('date_from', options.dateFrom);
    }
    if (options.dateTo) {
      queryParams.append('date_to', options.dateTo);
    }
    if (options.status) {
      queryParams.append('status', options.status);
    }
    if (options.clientId) {
      queryParams.append('client_id', String(options.clientId));
    }
    if (options.staffId) {
      queryParams.append('staff_id', String(options.staffId));
    }
    
    // Якщо потрібна інформація про клієнта, додаємо include параметри
    if (options.includeClient) {
      queryParams.append('include[]', 'client');
      queryParams.append('with[]', 'client');
    }
    
    const fullUrl = queryParams.toString() ? `${url}?${queryParams.toString()}` : url;
    
    const response = await altegioFetch<Appointment[] | { data?: Appointment[] }>(fullUrl, {
      method: 'GET',
    });
    
    let appointments: Appointment[] = [];
    if (Array.isArray(response)) {
      appointments = response;
    } else if (response && typeof response === 'object') {
      if ('data' in response && Array.isArray(response.data)) {
        appointments = response.data;
      } else if ('appointments' in response && Array.isArray(response.appointments)) {
        appointments = response.appointments;
      } else if ('items' in response && Array.isArray(response.items)) {
        appointments = response.items;
      }
    }
    
    // Фільтруємо тільки майбутні записи (якщо не вказано dateFrom)
    if (!options.dateFrom) {
      const now = new Date();
      appointments = appointments.filter(apt => {
        const aptDate = apt.datetime || apt.start_datetime || apt.date;
        if (!aptDate) return false;
        const aptDateTime = new Date(aptDate);
        return aptDateTime >= now;
      });
    }
    
    // Сортуємо за датою (від найближчих до найвіддаленіших)
    appointments.sort((a, b) => {
      const dateA = a.datetime || a.start_datetime || a.date || '';
      const dateB = b.datetime || b.start_datetime || b.date || '';
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });
    
    console.log(`[altegio/appointments] Got ${appointments.length} appointments for company ${companyId}`);
    return appointments;
  } catch (err) {
    console.error(`[altegio/appointments] Failed to get appointments for company ${companyId}:`, err);
    throw err;
  }
}

/**
 * Отримує майбутні записи на наступні N днів
 * @param companyId - ID компанії (філії/салону)
 * @param daysAhead - Кількість днів вперед (за замовчуванням 30)
 * @param includeClient - Включити інформацію про клієнта (для отримання Instagram username)
 */
export async function getUpcomingAppointments(
  companyId: number,
  daysAhead: number = 30,
  includeClient: boolean = true
): Promise<Appointment[]> {
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  // Форматуємо дати для API (YYYY-MM-DD)
  const dateFrom = now.toISOString().split('T')[0];
  const dateTo = futureDate.toISOString().split('T')[0];
  
  return getAppointments(companyId, {
    dateFrom,
    dateTo,
    includeClient,
  });
}

