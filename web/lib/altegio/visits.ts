// web/lib/altegio/visits.ts
// Функції для роботи з візитами (visits) Alteg.io API
// Візити - це завершені записи (appointments), які вже відбулися

import { altegioFetch } from './client';

export type Visit = {
  id: number;
  company_id: number;
  client_id?: number;
  client?: any; // Інформація про клієнта
  appointment_id?: number; // ID оригінального запису
  datetime?: string; // Дата та час візиту
  start_datetime?: string;
  end_datetime?: string;
  service_id?: number;
  service?: any; // Інформація про послугу
  staff_id?: number;
  staff?: any; // Інформація про майстра
  status?: string; // Статус візиту
  payment?: {
    status?: string;
    amount?: number;
    transactions?: any[];
  };
  transactions?: any[]; // Фінансові транзакції
  comment?: string;
  // ... інші поля з API
  [key: string]: any;
};

export type GetVisitsOptions = {
  dateFrom?: string; // Дата початку (ISO format або YYYY-MM-DD)
  dateTo?: string; // Дата кінця (ISO format або YYYY-MM-DD)
  status?: string; // Фільтр за статусом
  clientId?: number; // Фільтр за клієнтом
  staffId?: number; // Фільтр за майстром
  serviceId?: number; // Фільтр за послугою
  serviceIds?: number[]; // Фільтр за списком послуг
  includeClient?: boolean; // Включити інформацію про клієнта
  includeService?: boolean; // Включити інформацію про послугу
  includeStaff?: boolean; // Включити інформацію про майстра
  includePayment?: boolean; // Включити інформацію про оплату
};

/**
 * Отримує список візитів (завершених записів)
 * @param companyId - ID компанії (філії/салону)
 * @param options - Опції фільтрації
 */
export async function getVisits(
  companyId: number,
  options: GetVisitsOptions = {}
): Promise<Visit[]> {
  try {
    // Спробуємо різні варіанти endpoint для візитів
    // Згідно з документації: GET /visit/details/{salon_id}/{record_id}/{visit_id} - для конкретного візиту
    // Для списку візитів спробуємо різні варіанти
    const attempts = [
      {
        name: 'GET /visit/details/{salon_id} (try to get list)',
        method: 'GET' as const,
        url: `/visit/details/${companyId}`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /company/{id}/visit/details (list)',
        method: 'GET' as const,
        url: `/company/${companyId}/visit/details`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /dashboard_records/{id} (from web interface)',
        method: 'GET' as const,
        url: `/dashboard_records/${companyId}`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /company/{id}/records',
        method: 'GET' as const,
        url: `/company/${companyId}/records`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /records?company_id={id}',
        method: 'GET' as const,
        url: `/records`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /company/{id}/visits (list)',
        method: 'GET' as const,
        url: `/company/${companyId}/visits`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /visits?company_id={id}',
        method: 'GET' as const,
        url: `/visits`,
        queryParams: new URLSearchParams(),
      },
      {
        name: 'GET /company/{id}/visit (list)',
        method: 'GET' as const,
        url: `/company/${companyId}/visit`,
        queryParams: new URLSearchParams(),
      },
    ];

    // Додаємо параметри до query string
    // Для dashboard_records використовуємо start_date та end_date (як у веб-інтерфейсі)
    if (options.dateFrom) {
      attempts.forEach(attempt => {
        if (attempt.url.includes('dashboard_records')) {
          // Для dashboard_records використовуємо start_date та end_date
          attempt.queryParams.append('start_date', options.dateFrom!);
        } else {
          attempt.queryParams.append('date_from', options.dateFrom!);
        }
      });
    }
    if (options.dateTo) {
      attempts.forEach(attempt => {
        if (attempt.url.includes('dashboard_records')) {
          // Для dashboard_records використовуємо start_date та end_date
          attempt.queryParams.append('end_date', options.dateTo!);
        } else {
          attempt.queryParams.append('date_to', options.dateTo!);
        }
      });
    }
    if (options.status) {
      attempts.forEach(attempt => attempt.queryParams.append('status', options.status!));
    }
    if (options.clientId) {
      attempts.forEach(attempt => attempt.queryParams.append('client_id', String(options.clientId!)));
    }
    if (options.staffId) {
      attempts.forEach(attempt => attempt.queryParams.append('staff_id', String(options.staffId!)));
    }
    if (options.serviceId) {
      attempts.forEach(attempt => attempt.queryParams.append('service_id', String(options.serviceId!)));
    }
    if (options.serviceIds && options.serviceIds.length > 0) {
      // Спробуємо додати service_id як масив або окремі параметри
      options.serviceIds.forEach(serviceId => {
        attempts.forEach(attempt => attempt.queryParams.append('service_id[]', String(serviceId)));
      });
    }
    if (options.includeClient) {
      attempts.forEach(attempt => {
        attempt.queryParams.append('include[]', 'client');
        attempt.queryParams.append('with[]', 'client');
      });
    }
    if (options.includeService) {
      attempts.forEach(attempt => {
        attempt.queryParams.append('include[]', 'service');
        attempt.queryParams.append('with[]', 'service');
      });
    }
    if (options.includeStaff) {
      attempts.forEach(attempt => {
        attempt.queryParams.append('include[]', 'staff');
        attempt.queryParams.append('with[]', 'staff');
      });
    }
    if (options.includePayment) {
      attempts.forEach(attempt => {
        attempt.queryParams.append('include[]', 'payment');
        attempt.queryParams.append('include[]', 'transactions');
      });
    }

    // Для endpoint'ів без company_id в URL додаємо company_id в query
    attempts.forEach((attempt, index) => {
      if (!attempt.url.includes(`/${companyId}/`) && !attempt.url.includes(`/${companyId}`)) {
        attempt.queryParams.append('company_id', String(companyId));
      }
    });

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const queryString = attempt.queryParams.toString();
        const fullPath = queryString ? `${attempt.url}?${queryString}` : attempt.url;

        console.log(`[altegio/visits] Trying ${attempt.name}: ${fullPath}`);

        const response = await altegioFetch<
          Visit[] | { data?: Visit[]; visits?: Visit[]; items?: Visit[] }
        >(
          fullPath,
          { method: attempt.method }
        );

        let visits: Visit[] = [];
        if (Array.isArray(response)) {
          visits = response;
        } else if (response && typeof response === 'object') {
          if ('data' in response && Array.isArray(response.data)) {
            visits = response.data;
          } else if ('visits' in response && Array.isArray(response.visits)) {
            visits = response.visits;
          } else if ('items' in response && Array.isArray(response.items)) {
            visits = response.items;
          }
        }

        if (visits.length > 0) {
          console.log(`[altegio/visits] ✅ Got ${visits.length} visits using ${attempt.name}`);
          return visits;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[altegio/visits] ❌ Failed with ${attempt.name}:`, lastError.message);
        continue;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  } catch (err) {
    console.error(`[altegio/visits] Failed to get visits for company ${companyId}:`, err);
    throw err;
  }
}

/**
 * Отримує деталі конкретного візиту
 * @param companyId - ID компанії (salon_id)
 * @param recordId - ID запису (record_id)
 * @param visitId - ID візиту
 */
export async function getVisitDetails(
  companyId: number,
  recordId: number,
  visitId: number
): Promise<any> {
  try {
    const url = `/visit/details/${companyId}/${recordId}/${visitId}`;
    console.log(`[altegio/visits] Getting visit details: ${url}`);
    const response = await altegioFetch<any>(url);
    
    // Згідно з документацією, response має структуру:
    // { success: true, data: { items: [...], payment_transactions: [...], ... } }
    if (response && typeof response === 'object' && 'data' in response) {
      return response.data;
    }
    return response;
  } catch (err) {
    console.error(`[altegio/visits] Failed to get visit details:`, err);
    throw err;
  }
}

/**
 * Отримує деталі конкретного візиту (старий метод для сумісності, якщо немає recordId)
 * @param companyId - ID компанії
 * @param visitId - ID візиту
 * @deprecated Використовуйте getVisitDetails(companyId, recordId, visitId) замість цього
 */
export async function getVisitDetailsLegacy(
  companyId: number,
  visitId: number
): Promise<Visit | null> {
  try {
    // Спробуємо різні варіанти endpoint
    const attempts = [
      {
        name: 'GET /company/{id}/visit/{visit_id}',
        url: `/company/${companyId}/visit/${visitId}?include[]=client&include[]=service&include[]=staff&include[]=payment&include[]=transactions`,
      },
      {
        name: 'GET /visit/{visit_id}',
        url: `/visit/${visitId}?company_id=${companyId}&include[]=client&include[]=service&include[]=staff&include[]=payment&include[]=transactions`,
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[altegio/visits] Trying ${attempt.name} for visit ${visitId}...`);
        const response = await altegioFetch<Visit | { data?: Visit }>(attempt.url);

        if (response && typeof response === 'object') {
          let visit: Visit | null = null;
          if ('id' in response) {
            visit = response as Visit;
          } else if ('data' in response && response.data) {
            visit = response.data as Visit;
          }

          if (visit && visit.id) {
            console.log(`[altegio/visits] ✅ Got visit ${visitId} using ${attempt.name}`);
            return visit;
          }
        }
      } catch (err) {
        console.warn(`[altegio/visits] ❌ Failed with ${attempt.name}:`, err);
        continue;
      }
    }

    return null;
  } catch (err) {
    console.error(`[altegio/visits] Failed to get visit ${visitId}:`, err);
    return null;
  }
}

/**
 * Форматує рядок майстрів: головний та інші в дужках (лише імена, без ролей).
 */
export function formatMastersDisplay(
  mainStaffName: string | null,
  otherNames: string[]
): string {
  const main = (mainStaffName || '').toString().trim();
  const others = otherNames
    .map((n) => (n || '').toString().trim())
    .filter((n) => n && n !== main);
  const uniq = Array.from(new Set(others));
  if (!main) return uniq.join(', ') || '';
  if (uniq.length === 0) return main;
  return `${main} (${uniq.join(', ')})`;
}

/**
 * Викликає GET /visit/details та повертає рядок "Головний (Інший1, Інший2)" або null при помилці.
 */
export async function getMastersDisplayFromVisitDetails(
  companyId: number,
  recordId: number,
  visitId: number,
  mainStaffName: string | null
): Promise<string | null> {
  try {
    const data = await getVisitDetails(companyId, recordId, visitId);
    if (!data || typeof data !== 'object') return null;
    const items = Array.isArray(data.items) ? data.items : [];
    const otherNames: string[] = [];
    for (const item of items) {
      const name =
        (item as any).master?.title ??
        (item as any).master?.name ??
        (item as any).staff?.name ??
        (item as any).staff?.display_name ??
        (item as any).staff_title ??
        null;
      if (name && typeof name === 'string') {
        const t = name.trim();
        if (t && t !== (mainStaffName || '').trim()) otherNames.push(t);
      }
    }
    return formatMastersDisplay(mainStaffName, otherNames);
  } catch (err) {
    console.warn(
      '[altegio/visits] getMastersDisplayFromVisitDetails failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Отримує візити за період (минулі записи)
 * @param companyId - ID компанії
 * @param daysBack - Скільки днів назад (за замовчуванням 7)
 * @param includeAll - Включити всі додаткові дані
 */
export async function getPastVisits(
  companyId: number,
  daysBack: number = 7,
  includeAll: boolean = true
): Promise<Visit[]> {
  const now = new Date();
  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - daysBack);

  // Форматуємо дати для API (YYYY-MM-DD)
  const dateFrom = pastDate.toISOString().split('T')[0];
  const dateTo = now.toISOString().split('T')[0];

  return getVisits(companyId, {
    dateFrom,
    dateTo,
    includeClient: includeAll,
    includeService: includeAll,
    includeStaff: includeAll,
    includePayment: includeAll,
  });
}

