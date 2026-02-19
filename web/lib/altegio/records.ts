// web/lib/altegio/records.ts
// GET /records/{location_id} — історія записів клієнта (дата візиту + дата створення)

import { altegioFetch } from './client';

/** Один запис з відповіді API (нормалізований для внутрішнього використання). */
export type ClientRecord = {
  /** Дата та час візиту (сеансу). */
  date: string | null;
  /** Дата та час створення запису в системі. */
  create_date: string | null;
  /** Ідентифікатор візиту. */
  visit_id: number | null;
  /** Дата останньої зміни запису. */
  last_change_date: string | null;
  /** Послуги (для визначення консультація / платна). */
  services: Array<{ id?: number; title?: string; name?: string }>;
  /** Статус візиту: -1 не прийшов, 0 очікування, 1 прийшов, 2 підтвердив (Altegio). */
  attendance: number | null;
  /** Чи запис видалено в Altegio. */
  deleted: boolean;
  [key: string]: unknown;
};

/** Запис з client_id (для bulk GET /records без client_id). */
export type ClientRecordWithClientId = ClientRecord & { client_id?: number | null };

/** Сира відповідь API (структура може відрізнятися). */
type RecordsApiResponse = {
  data?: ClientRecord[] | ClientRecord | { records?: ClientRecord[]; data?: ClientRecord[] };
  meta?: { total_count?: number };
  success?: boolean;
  [key: string]: unknown;
};

/**
 * Перевіряє, чи є послуга "Консультація" або "Онлайн-консультація".
 * Узгоджено з логікою у вебхуках (isConsultationService).
 */
export function isConsultationService(services: any[]): { isConsultation: boolean; isOnline: boolean } {
  if (!Array.isArray(services) || services.length === 0) {
    return { isConsultation: false, isOnline: false };
  }
  let isConsultation = false;
  let isOnline = false;
  for (const s of services) {
    const title = (s?.title || s?.name || '').toString().toLowerCase();
    if (/консультаці/i.test(title)) {
      isConsultation = true;
      if (/онлайн/i.test(title) || /online/i.test(title)) isOnline = true;
    }
  }
  return { isConsultation, isOnline };
}

function normalizeRecord(raw: any): ClientRecord {
  const date = raw?.date ?? raw?.datetime ?? null;
  const createDate = raw?.create_date ?? raw?.created_at ?? raw?.createdAt ?? null;
  const visitId = raw?.visit_id ?? raw?.visitId ?? null;
  const lastChange = raw?.last_change_date ?? raw?.last_change ?? raw?.updated_at ?? null;
  const att = raw?.attendance ?? raw?.visit_attendance ?? raw?.visit_status ?? raw?.status ?? null;
  let attendance: number | null =
    att === 1 || att === 0 || att === -1 || att === 2 ? Number(att) : null;
  if (attendance === null && typeof att === 'string') {
    const s = String(att).toLowerCase().replace(/-/g, '_');
    if (s === 'arrived' || s === 'confirmed') attendance = 1;
    else if (s === 'no_show' || s === 'noshow' || s === 'absent') attendance = -1;
    else if (s === 'pending' || s === 'waiting') attendance = 0;
  }
  const deleted = raw?.deleted === true || raw?.deleted === 1;
  let services = raw?.services ?? raw?.data?.services ?? [];
  if (!Array.isArray(services)) services = [];
  return {
    date: date != null ? String(date) : null,
    create_date: createDate != null ? String(createDate) : null,
    visit_id: visitId != null ? Number(visitId) : null,
    last_change_date: lastChange != null ? String(lastChange) : null,
    services: services.map((s: any) => ({ id: s?.id, title: s?.title, name: s?.name })),
    attendance,
    deleted,
  };
}

function parseRecordsResponse(response: RecordsApiResponse): ClientRecord[] {
  if (!response || typeof response !== 'object') return [];
  const data = response.data;
  if (Array.isArray(data)) {
    return data.map(normalizeRecord);
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const recs = (data as any).records ?? (data as any).data;
    if (Array.isArray(recs)) return recs.map(normalizeRecord);
    return [normalizeRecord(data)];
  }
  return [];
}

function normalizeRecordWithClientId(raw: any): ClientRecordWithClientId {
  const rec = normalizeRecord(raw);
  const clientId = raw?.client_id ?? raw?.client?.id ?? null;
  return { ...rec, client_id: clientId != null && Number.isFinite(Number(clientId)) ? Number(clientId) : null };
}

function parseRecordsResponseWithClientId(response: RecordsApiResponse): ClientRecordWithClientId[] {
  if (!response || typeof response !== 'object') return [];
  const data = response.data;
  const mapRaw = (arr: any[]) => (Array.isArray(arr) ? arr.map(normalizeRecordWithClientId) : []);
  if (Array.isArray(data)) return mapRaw(data);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const recs = (data as any).records ?? (data as any).data;
    if (Array.isArray(recs)) return mapRaw(recs);
    return [normalizeRecordWithClientId(data)];
  }
  return [];
}

/**
 * Отримує список записів клієнта з Altegio (GET /records/{location_id}?client_id={id}).
 * Поля у відповіді: data.date (візит), data.create_date (створення), data.visit_id, data.last_change_date.
 */
export async function getClientRecords(
  locationId: number,
  clientId: number,
  options?: { includeFinanceTransactions?: boolean }
): Promise<ClientRecord[]> {
  const params = new URLSearchParams();
  params.set('client_id', String(clientId));
  if (options?.includeFinanceTransactions === true) {
    params.set('include_finance_transactions', '1');
  }
  const path = `records/${locationId}?${params.toString()}`;
  try {
    const response = await altegioFetch<RecordsApiResponse>(path, { method: 'GET' });
    const list = parseRecordsResponse(response);
    if (list.length > 0) {
      console.log(`[altegio/records] getClientRecords: locationId=${locationId}, clientId=${clientId}, count=${list.length}`);
    }
    return list;
  } catch (err) {
    console.warn(`[altegio/records] getClientRecords failed: locationId=${locationId}, clientId=${clientId}`, err);
    return [];
  }
}

/**
 * Отримує одну сторінку записів для локації (GET /records/{location_id} без client_id).
 * Параметри: start_date, end_date (YYYY-MM-DD), count, page.
 * meta.total_count — загальна кількість записів.
 */
export async function getAllRecordsForLocation(
  locationId: number,
  options: {
    startDate: string;
    endDate: string;
    count?: number;
    page?: number;
  }
): Promise<{ records: ClientRecordWithClientId[]; totalCount?: number }> {
  const params = new URLSearchParams();
  params.set('start_date', options.startDate);
  params.set('end_date', options.endDate);
  if (options.count != null && options.count > 0) params.set('count', String(options.count));
  if (options.page != null && options.page >= 1) params.set('page', String(options.page));
  const path = `records/${locationId}?${params.toString()}`;
  try {
    const response = await altegioFetch<RecordsApiResponse>(path, { method: 'GET' });
    const records = parseRecordsResponseWithClientId(response);
    const totalCount = response?.meta?.total_count;
    return { records, totalCount };
  } catch (err) {
    console.warn(`[altegio/records] getAllRecordsForLocation failed: locationId=${locationId}`, err);
    return { records: [] };
  }
}

/**
 * Завантажує всі записи локації з пагінацією (для масового backfill paidRecordsInHistoryCount).
 */
export async function fetchAllRecordsForLocation(
  locationId: number,
  options: {
    startDate?: string;
    endDate?: string;
    countPerPage?: number;
    delayMs?: number;
  } = {}
): Promise<ClientRecordWithClientId[]> {
  const startDate = options.startDate ?? '2020-01-01';
  const endDate = options.endDate ?? new Date().toISOString().split('T')[0];
  const countPerPage = Math.min(100, Math.max(10, options.countPerPage ?? 50));
  const delayMs = Math.max(100, options.delayMs ?? 250);
  const all: ClientRecordWithClientId[] = [];
  let page = 1;
  let totalCount: number | undefined;
  for (;;) {
    const { records, totalCount: tc } = await getAllRecordsForLocation(locationId, {
      startDate,
      endDate,
      count: countPerPage,
      page,
    });
    if (tc != null) totalCount = tc;
    all.push(...records);
    if (records.length < countPerPage || (totalCount != null && all.length >= totalCount)) break;
    page++;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log(`[altegio/records] fetchAllRecordsForLocation: locationId=${locationId}, total=${all.length} records`);
  return all;
}

/**
 * Отримує create_date з Records API для запису (fallback, коли вебхук не надсилає create_date).
 * Шукає запис за visit_id або за найближчою датою datetime.
 */
export async function fetchCreateDateFromRecordsAPI(
  locationId: number,
  clientId: number,
  visitId: number | string | null,
  datetime: string | null | undefined
): Promise<string | null> {
  if (!Number.isFinite(locationId) || !Number.isFinite(clientId)) return null;
  try {
    const records = await getClientRecords(locationId, clientId);
    if (records.length === 0) return null;

    const visitIdNum = visitId != null ? Number(visitId) : NaN;
    const targetTs = datetime ? new Date(datetime).getTime() : NaN;

    // 1. Шукаємо за visit_id
    if (Number.isFinite(visitIdNum)) {
      const byVisit = records.find((r) => r.visit_id === visitIdNum);
      if (byVisit?.create_date) return byVisit.create_date;
    }

    // 2. Шукаємо за найближчою датою datetime (візиту)
    if (Number.isFinite(targetTs)) {
      let best: ClientRecord | null = null;
      let bestDiff = Infinity;
      for (const r of records) {
        const rTs = r.date ? new Date(r.date).getTime() : NaN;
        if (!Number.isFinite(rTs)) continue;
        const diff = Math.abs(rTs - targetTs);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = r;
        }
      }
      if (best?.create_date && bestDiff < 24 * 60 * 60 * 1000) return best.create_date; // допуск 24 год
    }

    return null;
  } catch (err) {
    console.warn(`[altegio/records] fetchCreateDateFromRecordsAPI failed: locationId=${locationId}, clientId=${clientId}`, err);
    return null;
  }
}
