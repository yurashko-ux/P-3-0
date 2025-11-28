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
    // Базові параметри періоду/фільтрів
    const baseFilters: Record<string, any> = {};
    if (options.dateFrom) baseFilters.date_from = options.dateFrom;
    if (options.dateTo) baseFilters.date_to = options.dateTo;
    if (options.status) baseFilters.status = options.status;
    if (options.clientId) baseFilters.client_id = options.clientId;
    if (options.staffId) baseFilters.staff_id = options.staffId;

    const includeBlocks: string[] = [];
    if (options.includeClient) {
      includeBlocks.push('client');
    }

    // Формуємо список різних варіантів endpoint'ів (як у clients.ts)
    const attempts: Array<{
      name: string;
      method: 'GET' | 'POST';
      path: string;
      body?: any;
      useQuery?: boolean;
    }> = [
      // 0. Schedule API — список запланованих записів та подій
      {
        name: 'GET /schedule/events (Schedule API, recommended)',
        method: 'GET',
        path: `/schedule/events`,
        useQuery: true,
      },
      {
        name: 'POST /company/{id}/appointments/search (recommended)',
        method: 'POST',
        path: `/company/${companyId}/appointments/search`,
        body: {
          page: 1,
          page_size: 500,
          ...baseFilters,
          ...(includeBlocks.length
            ? {
                include: includeBlocks,
                with: includeBlocks,
              }
            : {}),
        },
      },
      {
        name: 'POST /company/{id}/appointments',
        method: 'POST',
        path: `/company/${companyId}/appointments`,
        body: {
          ...baseFilters,
          ...(includeBlocks.length
            ? {
                include: includeBlocks,
                with: includeBlocks,
              }
            : {}),
        },
      },
      {
        name: 'GET /company/{id}/appointments with query',
        method: 'GET',
        path: `/company/${companyId}/appointments`,
        useQuery: true,
      },
      {
        name: 'POST /appointments/search',
        method: 'POST',
        path: `/appointments/search`,
        body: {
          // у новій документації використовується location_id
          location_id: companyId,
          page: 1,
          page_size: 500,
          ...baseFilters,
          ...(includeBlocks.length
            ? {
                include: includeBlocks,
                with: includeBlocks,
              }
            : {}),
        },
      },
      {
        name: 'GET /appointments?location_id=...',
        method: 'GET',
        path: `/appointments`,
        useQuery: true,
      },
    ];

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      let fullPathForLog = attempt.path;
      try {
        const queryParams = new URLSearchParams();

        if (attempt.useQuery) {
          // Додаємо фільтри до query string
          if (baseFilters.date_from) queryParams.set('date_from', baseFilters.date_from);
          if (baseFilters.date_to) queryParams.set('date_to', baseFilters.date_to);
          if (baseFilters.status) queryParams.set('status', baseFilters.status);
          if (baseFilters.client_id) queryParams.set('client_id', String(baseFilters.client_id));
          if (baseFilters.staff_id) {
            // Schedule API використовує staff_id або staff_ids[]
            queryParams.set('staff_id', String(baseFilters.staff_id));
          }
          if (includeBlocks.length) {
            includeBlocks.forEach((inc) => {
              queryParams.append('include[]', inc);
              queryParams.append('with[]', inc);
            });
          }
          if (attempt.path === '/appointments') {
            queryParams.set('company_id', String(companyId));
          }
          if (attempt.path === '/schedule/events') {
            // Schedule API очікує location_id
            queryParams.set('location_id', String(companyId));
          }
        }

        const fullPath =
          attempt.useQuery && queryParams.toString()
            ? `${attempt.path}?${queryParams.toString()}`
            : attempt.path;

        fullPathForLog = fullPath;

        console.log(`[altegio/appointments] Trying ${attempt.name} → ${fullPathForLog}`);

        const response = await altegioFetch<
          | Appointment[]
          | {
              data?: any[];
              appointments?: any[];
              items?: any[];
              results?: any[];
              success?: boolean;
            }
        >(fullPath, {
          method: attempt.method,
          ...(attempt.method === 'POST'
            ? { body: JSON.stringify(attempt.body ?? {}) }
            : {}),
        });

        let appointments: Appointment[] = [];

        if (Array.isArray(response)) {
          appointments = response as any[];
        } else if (response && typeof response === 'object') {
          const obj: any = response;

          // Стандартні для Altegio контейнери
          if (Array.isArray(obj.data)) {
            appointments = obj.data;
          } else if (Array.isArray(obj.appointments)) {
            appointments = obj.appointments;
          } else if (Array.isArray(obj.items)) {
            appointments = obj.items;
          } else if (Array.isArray(obj.results)) {
            appointments = obj.results;
          }

          // Schedule API: success/data, де data = events[]
          if (!appointments.length && obj.success === true && Array.isArray(obj.data?.events)) {
            appointments = obj.data.events;
          }
        }

        console.log(
          `[altegio/appointments] Response from ${attempt.name}: count=${appointments.length}`,
        );

        if (appointments.length === 0) {
          // Пробуємо наступний endpoint
          continue;
        }

        // Фільтруємо тільки майбутні записи (якщо не вказано dateFrom)
        if (!options.dateFrom) {
          const now = new Date();
          appointments = appointments.filter((apt) => {
            const aptDate = (apt as any).datetime || (apt as any).start_datetime || (apt as any).date;
            if (!aptDate) return false;
            const aptDateTime = new Date(aptDate);
            return aptDateTime >= now;
          });
        }

        // Сортуємо за датою (від найближчих до найвіддаленіших)
        appointments.sort((a, b) => {
          const dateA =
            (a as any).datetime || (a as any).start_datetime || (a as any).date || '';
          const dateB =
            (b as any).datetime || (b as any).start_datetime || (b as any).date || '';
          return new Date(dateA).getTime() - new Date(dateB).getTime();
        });

        console.log(
          `[altegio/appointments] ✅ Got ${appointments.length} appointments for company ${companyId} using ${attempt.name}`,
        );
        return appointments;
      } catch (err) {
        const wrapped =
          err instanceof Error
            ? err
            : new Error(typeof err === 'string' ? err : JSON.stringify(err));

        // Зберігаємо останню помилку з інформацією про endpoint
        wrapped.message = `[${attempt.name}] ${fullPathForLog} :: ${wrapped.message}`;
        lastError = wrapped;

        console.warn(
          `[altegio/appointments] ❌ ${attempt.name} failed for company ${companyId}:`,
          wrapped.message,
        );
        continue;
      }
    }

    if (lastError) {
      throw lastError;
    }

    console.warn(`[altegio/appointments] No appointments found for company ${companyId}`);
    return [];
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

