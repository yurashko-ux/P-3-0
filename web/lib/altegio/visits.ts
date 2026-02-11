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
 * Крок 1: GET /visits/{visit_id} — отримуємо location_id та список record_id (записів) у візиті.
 * В одному візиті може бути кілька записів (різні майстри).
 */
export async function getVisitWithRecords(visitId: number, companyIdFallback?: number): Promise<{
  locationId: number | null;
  records: Array<{ id: number; staff_id?: number; staff?: { name?: string; display_name?: string }; services?: any[]; goods_transactions?: any[] }>;
  [key: string]: any;
} | null> {
  try {
    const url = `/visits/${visitId}`;
    const response = await altegioFetch<any>(url);
    const data = response?.data ?? response;
    if (!data || typeof data !== 'object') {
      console.warn('[altegio/visits] getVisitWithRecords: no data in response for visit', visitId);
      return null;
    }
    const records = Array.isArray(data.records) ? data.records : [];
    const locationId =
      data.location_id ?? data.company_id ?? data.locationId ?? companyIdFallback ?? null;
    const numLocationId =
      typeof locationId === 'number' ? locationId : Number(locationId);
    
    // Дозволяємо продовжити навіть без locationId, якщо є records
    if ((!numLocationId || Number.isNaN(numLocationId)) && records.length === 0) {
      console.warn('[altegio/visits] getVisitWithRecords: no location_id and no records for visit', visitId);
      return null;
    }
    
    console.log('[altegio/visits] getVisitWithRecords: visitId', visitId, 'locationId', numLocationId || 'fallback', 'records', records.length);
    return { locationId: numLocationId || null, records, ...data };
  } catch (err) {
    console.error('[altegio/visits] getVisitWithRecords failed:', err);
    return null;
  }
}

export type VisitBreakdownItem = { masterName: string; sumUAH: number };

/**
 * Модель згідно з документацією Altegio:
 * 1. GET /visits/{visitId} → location_id та список record_id.
 * 2. GET /visit/details/{location_id}/{record_id}/{visit_id} — один виклик достатній: API Altegio повертає всі items візиту в кожній відповіді, тому виклик для кожного record давав подвійний підрахунок (12 → 24 тис.).
 * 3. Агрегація по master_id з data.items (та payment_transactions лише де немає items).
 */
export async function fetchVisitBreakdownFromAPI(
  visitId: number,
  companyIdFallback: number
): Promise<VisitBreakdownItem[] | null> {
  try {
    const visitData = await getVisitWithRecords(visitId, companyIdFallback);
    if (!visitData || !visitData.records?.length) {
      console.warn('[altegio/visits] fetchVisitBreakdownFromAPI: no records for visit', visitId);
      return null;
    }
    const locationId = visitData.locationId ?? companyIdFallback;
    const firstRecord = visitData.records[0];
    const recordId = firstRecord?.id ?? (firstRecord as any)?.record_id;
    if (recordId == null) {
      console.warn('[altegio/visits] fetchVisitBreakdownFromAPI: no recordId for visit', visitId);
      return null;
    }

    // Один виклик: API повертає повний список items візиту незалежно від record_id — уникнення подвоєння суми.
    const data = await getVisitDetails(locationId, Number(recordId), visitId);
    if (!data || typeof data !== 'object') {
      console.warn('[altegio/visits] fetchVisitBreakdownFromAPI: no data for recordId', recordId, 'visitId', visitId);
      return null;
    }

    const masterIdToName = new Map<number, string>();
    for (const rec of visitData.records) {
      const staff = (rec as any).staff;
      const staffId = (rec as any).staff_id ?? staff?.id;
      const staffName =
        staff?.name ?? staff?.display_name ?? staff?.full_name ?? (staff?.first_name && staff?.last_name ? `${staff.first_name} ${staff.last_name}`.trim() : null);
      if (staffId != null && staffName) masterIdToName.set(Number(staffId), String(staffName).trim());
    }

    function itemMasterName(item: any): string | null {
      const masterId = item?.master_id ?? item?.master?.id ?? item?.staff_id ?? item?.specialist_id;
      const fromMap = masterId != null ? masterIdToName.get(Number(masterId)) : null;
      if (fromMap) return fromMap;
      const master = item?.master ?? item?.staff ?? item?.specialist;
      if (master && typeof master === 'object') {
        const n = master.name ?? master.display_name ?? master.full_name ?? master.title ?? (master.first_name && master.last_name ? `${master.first_name} ${master.last_name}`.trim() : null);
        if (n && typeof n === 'string') return n.trim();
      }
      return item?.staff_title ?? item?.staff_name ?? item?.item_title ?? null;
    }

    const byMasterKey = new Map<string, { masterName: string; sumUAH: number }>();
    let pendingSum = 0;

    const addToMaster = (key: string, masterName: string, sumUAH: number) => {
      const existing = byMasterKey.get(key);
      if (existing) {
        existing.sumUAH += sumUAH;
      } else {
        byMasterKey.set(key, { masterName, sumUAH });
      }
    };

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const masterId = (item as any).master_id ?? (item as any).master?.id ?? (item as any).staff_id;
      const name = itemMasterName(item);
      const cost = Number((item as any).cost) || 0;
      const amount = Number((item as any).amount) ?? 1;
      const sum = Math.round(cost * amount);
      if (sum <= 0) continue;
      if (name) {
        const key = masterId != null && masterId !== 0 ? `id:${masterId}` : `name:${name.toLowerCase()}`;
        addToMaster(key, name, sum);
      } else {
        pendingSum += sum;
      }
    }

    const paymentTx = Array.isArray(data.payment_transactions) ? data.payment_transactions : [];
    const masterIdsInItems = new Set(
      items.map((i: any) => {
        const id = (i as any).master_id ?? (i as any).staff_id;
        return id != null && id !== 0 ? String(id) : null;
      }).filter(Boolean)
    );
    for (const tx of paymentTx) {
      const masterId = (tx as any).master_id ?? (tx as any).master?.id ?? (tx as any).staff_id;
      if (masterId != null && masterIdsInItems.has(String(masterId))) continue;
      const amount = Number((tx as any).amount) || 0;
      if (amount <= 0) continue;
      const name = masterId != null ? masterIdToName.get(Number(masterId)) ?? null : null;
      if (name) {
        const key = masterId != null && masterId !== 0 ? `id:${masterId}` : `name:${name.toLowerCase()}`;
        addToMaster(key, name, Math.round(amount));
      } else {
        pendingSum += Math.round(amount);
      }
    }

    if (pendingSum > 0) {
      if (byMasterKey.size > 0) {
        const firstKey = byMasterKey.keys().next().value;
        if (firstKey) {
          const first = byMasterKey.get(firstKey)!;
          first.sumUAH += pendingSum;
        }
      } else if (visitData.records.length > 0) {
        const firstRec = visitData.records[0];
        const staffName = firstRec.staff?.name ?? firstRec.staff?.display_name ?? (firstRec as any).staff?.full_name;
        if (staffName) {
          addToMaster(`name:${String(staffName).toLowerCase()}`, String(staffName).trim(), pendingSum);
        }
      }
    }

    const result = Array.from(byMasterKey.values()).filter((x) => x.sumUAH > 0);
    console.log('[altegio/visits] fetchVisitBreakdownFromAPI: visitId', visitId, 'total', result.reduce((a, b) => a + b.sumUAH, 0), 'result:', JSON.stringify(result));
    return result.length > 0 ? result : null;
  } catch (err) {
    console.error('[altegio/visits] fetchVisitBreakdownFromAPI failed:', err);
    return null;
  }
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

