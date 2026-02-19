// web/lib/altegio/visits.ts
// Функції для роботи з візитами (visits) Alteg.io API
// Візити - це завершені записи (appointments), які вже відбулися
// Джерело даних: тільки API Altegio (ніяких даних з KV).

import { altegioFetch } from './client';
import { getClientRecords, isConsultationService } from './records';

/** Нормалізація відповіді API: підтримка response.data або response, різні варіанти ключів */
function normalizeVisitResponse(raw: any): any {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data ?? raw;
  if (!data || typeof data !== 'object') return null;
  return data;
}

/** Витягуємо масив records з відповіді GET /visits/{id} (різні варіанти ключів API) */
function getRecordsFromVisitData(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const arr = data.records ?? data.visit_records ?? data.appointments ?? data.items;
  return Array.isArray(arr) ? arr : [];
}

/** Витягуємо location_id / company_id з відповіді GET /visits/{id} */
function getLocationIdFromVisitData(data: any): number | null {
  if (!data || typeof data !== 'object') return null;
  const v = data.location_id ?? data.company_id ?? data.locationId ?? data.salon_id;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Витягуємо id запису з об'єкта record (API може повертати id або record_id) */
function getRecordId(rec: any): number | null {
  if (!rec || typeof rec !== 'object') return null;
  const v = rec.id ?? rec.record_id;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Витягуємо масив items (послуги та товари) з відповіді GET /visit/details. Без data.transactions, щоб не плутати з платежами. */
function getItemsFromDetailsData(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const arr = data.items ?? data.visit_items ?? data.services;
  return Array.isArray(arr) ? arr : [];
}

/** Нормалізація поля item: cost (або price), amount (або quantity), master_id (або masterId, staff_id) */
function getItemCost(item: any): number {
  const v = item?.cost ?? item?.price ?? item?.sum ?? item?.total;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function getItemAmount(item: any): number {
  const v = item?.amount ?? item?.quantity ?? item?.count ?? 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function getItemMasterId(item: any): number | null {
  const v = item?.master_id ?? item?.masterId ?? item?.staff_id ?? item?.staffId;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
    if (process.env.DEBUG_ALTEGIO === '1' || process.env.DEBUG_ALTEGIO === 'true') {
      console.log(`[altegio/visits] Getting visit details: ${url}`);
    }
    const response = await altegioFetch<any>(url);
    // Нормалізація: API може повертати { data: { items, payment_transactions } } або { items, payment_transactions }
    return normalizeVisitResponse(response) ?? response;
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
 * Отримує статус візиту (attendance) з GET /visits/{visit_id}.
 * Згідно з документацією: data.attendance — загальний статус; data.records[].attendance / visit_attendance — по запису.
 * Повертає: 1 | 0 | -1 | 2 | null (1/2 = прийшов, 0 = очікування, -1 = не з'явився).
 */
export async function getVisitAttendance(visitId: number): Promise<number | null> {
  const visit = await getVisitWithRecords(visitId);
  if (!visit || typeof visit !== 'object') return null;
  const att = (visit as any).attendance ?? (visit as any).visit_attendance;
  if (att === 1 || att === 0 || att === -1 || att === 2) return Number(att);
  const records = getRecordsFromVisitData(visit);
  const first = records[0];
  if (first && typeof first === 'object') {
    const rAtt = (first as any).attendance ?? (first as any).visit_attendance;
    if (rAtt === 1 || rAtt === 0 || rAtt === -1 || rAtt === 2) return Number(rAtt);
  }
  return null;
}

/**
 * GET /visits/{visit_id} — отримуємо деталі візиту з Altegio API.
 *
 * Формат відповіді (GET https://api.alteg.io/api/v1/visits/{visit_id}):
 * { "success": true, "data": { "attendance": 1, "datetime": "...", "records": [...] } }
 *
 * Коди attendance (data.attendance або records[].attendance/visit_attendance):
 * - 1 — клієнт прийшов (послуги надані)
 * - 2 — клієнт підтвердив візит
 * - 0 — очікування (запис створено, клієнт ще не прийшов)
 * - -1 — клієнт не з'явився
 *
 * В одному візиті може бути кілька записів (records). Кожен record містить id, staff_id, staff, services.
 */
export async function getVisitWithRecords(visitId: number, companyIdFallback?: number): Promise<{
  locationId: number | null;
  records: Array<{ id: number; staff_id?: number; staff?: { name?: string; title?: string }; services?: any[]; goods_transactions?: any[] }>;
  [key: string]: any;
} | null> {
  try {
    const url = `/visits/${visitId}`;
    const response = await altegioFetch<any>(url);
    const data = normalizeVisitResponse(response);
    if (!data) {
      console.warn('[altegio/visits] getVisitWithRecords: no data in response for visit', visitId);
      return null;
    }
    const records = getRecordsFromVisitData(data);
    const locationId = getLocationIdFromVisitData(data) ?? companyIdFallback ?? null;
    const numLocationId =
      locationId !== null && Number.isFinite(Number(locationId)) ? Number(locationId) : null;

    // Дозволяємо продовжити навіть без locationId, якщо є records
    if ((numLocationId == null || !Number.isFinite(numLocationId)) && records.length === 0) {
      console.warn('[altegio/visits] getVisitWithRecords: no location_id and no records for visit', visitId);
      return null;
    }

    if (process.env.DEBUG_ALTEGIO === '1' || process.env.DEBUG_ALTEGIO === 'true') {
      console.log('[altegio/visits] getVisitWithRecords: visitId', visitId, 'locationId', numLocationId ?? 'fallback', 'records', records.length);
    }
    return { locationId: numLocationId ?? null, records, ...data };
  } catch (err) {
    // 404 — очікувано для видалених або невалідних візитів, не засмічуємо логи як error.
    // Перевіряємо status за значенням, бо після бандлингу instanceof може не спрацювати.
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      console.warn('[altegio/visits] Visit not found (deleted or invalid):', visitId);
      return null;
    }
    console.error('[altegio/visits] getVisitWithRecords failed:', err);
    return null;
  }
}

export type VisitBreakdownItem = { masterName: string; sumUAH: number };

/**
 * Деталізація візиту по майстрах: лише послуги та товари (data.items), без платежів.
 * Крок 1: GET /visits/{visit_id} → location_id та список record_id (data.records з staff_id, staff).
 * Крок 2: для кожного record_id виклик GET /visit/details → data.items (cost, amount, master_id). Сумуємо cost×amount по майстрах.
 * Імена майстрів з data.records[].staff (staff.title, staff.name).
 * Якщо передано onlyRecordId — рахуємо тільки цей запис (один record у візиті).
 */
export async function fetchVisitBreakdownFromAPI(
  visitId: number,
  companyIdFallback: number,
  onlyRecordId?: number
): Promise<VisitBreakdownItem[] | null> {
  try {
    const visitData = await getVisitWithRecords(visitId, companyIdFallback);
    if (!visitData) return null;
    if (!visitData.records?.length) {
      console.warn('[altegio/visits] fetchVisitBreakdownFromAPI: no records for visit', visitId);
      return null;
    }
    const locationId = visitData.locationId ?? companyIdFallback;

    // Імена майстрів тільки з GET /visits data.records[].staff (API: staff_id, staff.title / staff.name)
    const masterIdToName = new Map<number, string>();
    for (const rec of visitData.records) {
      const staff = (rec as any).staff;
      const staffId = (rec as any).staff_id ?? staff?.id ?? (rec as any).master_id;
      const staffName = staff?.title ?? staff?.name ?? (rec as any).master_name;
      if (staffId != null && staffName != null && String(staffName).trim()) {
        masterIdToName.set(Number(staffId), String(staffName).trim());
      }
    }

    // Якщо вказано onlyRecordId — обробляємо тільки цей запис (сума по одному record, не по всьому візиту)
    const recordsToProcess =
      onlyRecordId != null
        ? visitData.records.filter((rec) => getRecordId(rec) === onlyRecordId)
        : visitData.records;
    if (onlyRecordId != null && recordsToProcess.length === 0) {
      console.warn('[altegio/visits] fetchVisitBreakdownFromAPI: recordId', onlyRecordId, 'not found in visit', visitId);
      return null;
    }

    const byMasterKey = new Map<string, { masterName: string; sumUAH: number }>();
    let pendingSum = 0;
    const seenItemKeys = new Set<string>();

    const addToMaster = (key: string, masterName: string, sumUAH: number) => {
      const existing = byMasterKey.get(key);
      if (existing) {
        existing.sumUAH += sumUAH;
      } else {
        byMasterKey.set(key, { masterName, sumUAH });
      }
    };

    // Крок 2: для кожного record_id — GET /visit/details. Рахуємо лише послуги та товари (items), без платежів.
    for (const rec of recordsToProcess) {
      const recordId = getRecordId(rec);
      if (recordId == null) continue;

      const rawDetails = await getVisitDetails(locationId, recordId, visitId);
      const detailsData = rawDetails && typeof rawDetails === 'object' ? rawDetails : null;
      if (!detailsData) continue;

      const items = getItemsFromDetailsData(detailsData);
      for (const item of items) {
        const cost = getItemCost(item);
        const amount = getItemAmount(item);
        const sum = Math.round(cost * amount);
        if (sum <= 0) continue;

        const masterId = getItemMasterId(item);
        const itemId = item?.id ?? item?.item_id;
        const itemTitle = item?.item_title ?? item?.title ?? item?.name ?? '';
        const dedupeKey =
          itemId != null && itemId !== ''
            ? `id:${itemId}`
            : `${masterId ?? 'n'}:${itemTitle}:${cost}:${amount}`;
        if (seenItemKeys.has(dedupeKey)) continue;
        seenItemKeys.add(dedupeKey);

        const name = masterId != null ? masterIdToName.get(Number(masterId)) ?? null : null;
        if (name) {
          addToMaster(`id:${masterId}`, name, sum);
        } else {
          pendingSum += sum;
        }
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
        const staffName = (firstRec as any).staff?.title ?? (firstRec as any).staff?.name;
        if (staffName && typeof staffName === 'string') {
          addToMaster(`name:${String(staffName).toLowerCase()}`, String(staffName).trim(), pendingSum);
        }
      }
    }

    const result = Array.from(byMasterKey.values()).filter((x) => x.sumUAH > 0);
    if (process.env.DEBUG_ALTEGIO === '1' || process.env.DEBUG_ALTEGIO === 'true') {
      console.log('[altegio/visits] fetchVisitBreakdownFromAPI: visitId', visitId, 'total', result.reduce((a, b) => a + b.sumUAH, 0), 'result:', JSON.stringify(result));
    }
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

/**
 * Кількість платних візитів до поточного запису (0 = перший платний, вогник).
 * Використовує GET /records (getClientRecords) — той самий API, що в sync-visit-history-from-api.
 * При помилці повертає null.
 */
export async function getPaidRecordsInHistoryCount(
  locationId: number,
  altegioClientId: number,
  beforeDatetime: string
): Promise<number | null> {
  try {
    const beforeDate = new Date(beforeDatetime);
    if (!Number.isFinite(beforeDate.getTime())) return null;
    const beforeTs = beforeDate.getTime();
    const records = await getClientRecords(locationId, altegioClientId);
    const count = records.filter((r) => {
      if (r.deleted || !r.services?.length) return false;
      if (isConsultationService(r.services).isConsultation) return false;
      const dt = r.date ?? r.create_date;
      if (!dt) return false;
      const ts = new Date(dt).getTime();
      return Number.isFinite(ts) && ts < beforeTs;
    }).length;
    return count;
  } catch (err) {
    console.warn('[altegio/visits] getPaidRecordsInHistoryCount failed:', err);
    return null;
  }
}

