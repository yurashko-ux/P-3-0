// web/lib/altegio/records.ts
// GET /records/{location_id} — історія записів клієнта (дата візиту + дата створення)

import { AltegioHttpError, altegioFetch } from './client';
import { parseMoneyString } from './staff-period-income';

/** Один запис з відповіді API (нормалізований для внутрішнього використання). */
export type ClientRecord = {
  /** Ідентифікатор запису (appointment / order). */
  record_id?: number | null;
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
  /** Майстер запису з Altegio records, якщо відданий API. */
  staff_id?: number | null;
  staff_name?: string | null;
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
  const recordId = raw?.id ?? raw?.record_id ?? raw?.recordId ?? null;
  const lastChange = raw?.last_change_date ?? raw?.last_change ?? raw?.updated_at ?? null;
  const att = raw?.attendance ?? raw?.visit_attendance ?? raw?.visit_status ?? raw?.status ?? null;
  const staff = raw?.staff ?? raw?.data?.staff ?? null;
  const staffId = staff?.id ?? raw?.staff_id ?? raw?.data?.staff_id ?? null;
  const staffName = staff?.name ?? staff?.title ?? staff?.display_name ?? raw?.staff_name ?? raw?.data?.staff_name ?? null;
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
    record_id: recordId != null ? Number(recordId) : null,
    date: date != null ? String(date) : null,
    create_date: createDate != null ? String(createDate) : null,
    visit_id: visitId != null ? Number(visitId) : null,
    last_change_date: lastChange != null ? String(lastChange) : null,
    services: services.map((s: any) => ({ id: s?.id, title: s?.title, name: s?.name })),
    attendance,
    deleted,
    staff_id: staffId != null ? Number(staffId) : null,
    staff_name: staffName != null ? String(staffName) : null,
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
 * Отримує сирі записи з відповіді API (для імпорту в KV).
 * Підтримує різні формати: response.data, response.records, response.items, response.data.records.
 */
function getRawRecordsArray(response: RecordsApiResponse): any[] {
  return getRawRecordsArrayFromResponse(response);
}

/**
 * Експортована функція для діагностики та зовнішнього використання.
 * Витягує масив записів з будь-якого варіанту відповіді Altegio API.
 */
export function getRawRecordsArrayFromResponse(response: unknown): any[] {
  if (!response || typeof response !== 'object') return [];
  const r = response as Record<string, unknown>;
  // Прямий масив
  if (Array.isArray(r)) return r;
  // response.data
  const data = r.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const recs = d.records ?? d.data ?? d.items;
    if (Array.isArray(recs)) return recs;
    return [data];
  }
  // response.records, response.items (корінь)
  const rootRecs = r.records ?? r.items;
  if (Array.isArray(rootRecs)) return rootRecs;
  return [];
}

/**
 * Конвертує сирий запис з Altegio records в формат record-event для KV (altegio:records:log).
 * Використовується в import-altegio-full та backfill-records-log.
 */
export function rawRecordToRecordEvent(raw: any, clientId: number, companyId: number): Record<string, unknown> {
  const services = raw?.services ?? raw?.data?.services ?? [];
  const servicesForEvent = Array.isArray(services)
    ? services.map((s: any) => ({
        id: s?.id,
        title: s?.title || s?.name,
        name: s?.name || s?.title,
        cost: (s as any)?.cost ?? (s as any)?.paid_sum ?? (s as any)?.first_cost ?? 0,
        amount: (s as any)?.amount ?? 1,
      }))
    : [];

  const staff = raw?.staff ?? raw?.data?.staff;
  const staffName = staff?.name ?? staff?.title ?? staff?.display_name ?? null;
  const staffId = staff?.id ?? raw?.staff_id ?? raw?.data?.staff_id ?? null;

  const datetime = raw?.date ?? raw?.datetime ?? raw?.data?.datetime ?? null;
  const createDate = raw?.create_date ?? raw?.created_at ?? raw?.data?.create_date ?? null;
  const lastChange = raw?.last_change_date ?? raw?.last_change ?? raw?.updated_at ?? raw?.data?.last_change_date ?? null;
  const att = raw?.attendance ?? raw?.visit_attendance ?? raw?.data?.attendance ?? null;
  const attendance =
    att === 1 || att === 0 || att === -1 || att === 2 ? Number(att) : null;
  const visitId = raw?.visit_id ?? raw?.visitId ?? raw?.data?.visit_id ?? null;
  const recordId = raw?.id ?? raw?.record_id ?? raw?.data?.record_id ?? null;

  return {
    visitId: visitId != null ? Number(visitId) : null,
    recordId: recordId != null ? Number(recordId) : null,
    status: 'create',
    datetime: datetime ? String(datetime) : null,
    create_date: createDate ? String(createDate) : undefined,
    last_change_date: lastChange ? String(lastChange) : undefined,
    serviceId: servicesForEvent[0]?.id ?? null,
    serviceName: servicesForEvent[0]?.title ?? servicesForEvent[0]?.name ?? null,
    staffId: staffId != null ? Number(staffId) : null,
    staffName: staffName ? String(staffName) : null,
    clientId,
    companyId,
    receivedAt: new Date().toISOString(),
    attendance,
    visit_attendance: att,
    data: {
      services: servicesForEvent,
      staff: staff || { id: staffId, name: staffName },
      client: { id: clientId },
      attendance: att,
    },
  };
}

/**
 * Отримує сирі записи клієнта з Altegio (GET /records) — для імпорту в KV.
 * Зберігає повну структуру services (cost, paid_sum тощо) для record-event формату.
 * Використовує fallback на альтернативні endpoint'и, якщо основний повертає порожній масив.
 */
export async function getClientRecordsRaw(
  locationId: number,
  clientId: number,
  options?: {
    retries?: number;
    delay?: number;
    timeoutMs?: number;
  }
): Promise<any[]> {
  const clientIdStr = String(clientId);
  const attempts: { path: string; params?: Record<string, string> }[] = [
    { path: `records/${locationId}`, params: { client_id: clientIdStr } },
    { path: `company/${locationId}/records`, params: { client_id: clientIdStr } },
    { path: `records`, params: { company_id: String(locationId), client_id: clientIdStr } },
  ];

  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams(attempt.params || {});
      const path = attempt.path + (params.toString() ? `?${params.toString()}` : '');
      const response = await altegioFetch<RecordsApiResponse>(
        path,
        { method: 'GET' },
        options?.retries ?? 3,
        options?.delay ?? 200,
        options?.timeoutMs ?? 30000
      );
      const list = getRawRecordsArrayFromResponse(response);
      if (list.length > 0) {
        if (attempt.path !== `records/${locationId}`) {
          console.log(`[altegio/records] getClientRecordsRaw: fallback ${attempt.path} повернув ${list.length} записів для clientId=${clientId}`);
        }
        return list.map((r) => ({ ...r, client_id: clientId }));
      }
    } catch (err) {
      console.warn(`[altegio/records] getClientRecordsRaw attempt ${attempt.path} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  return [];
}

/**
 * Отримує список записів клієнта з Altegio (GET /records).
 * Використовує getClientRecordsRaw для узгодженості з backfill/import — підтримує fallback endpoint'и
 * та різні формати відповіді (response.data, response.records, response.items).
 */
export async function getClientRecords(
  locationId: number,
  clientId: number,
  options?: {
    includeFinanceTransactions?: boolean;
    retries?: number;
    delay?: number;
    timeoutMs?: number;
  }
): Promise<ClientRecord[]> {
  const raw = await getClientRecordsRaw(locationId, clientId, options);
  const list = raw.map((r) => normalizeRecord(r));
  if (list.length > 0) {
    console.log(`[altegio/records] getClientRecords: locationId=${locationId}, clientId=${clientId}, count=${list.length}`);
  }
  return list;
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

/** Оборот за період з GET /records/{location_id} (послуги cost / first_cost−discount, товари cost_to_pay), узгоджено з інструкцією Altegio. */
export type RecordsMtdByStaffResult =
  | {
      ok: true;
      byStaffId: Map<number, number>;
      recordsScanned: number;
      pagesFetched: number;
      /** Який базовий шлях дав дані (для логів). */
      recordsPathUsed?: 'records' | 'company_records';
    }
  | { ok: false; reason: string; recordsScanned: number; pagesFetched: number };

/** Лише візити з фактичним приходом (як звіт «Продажі по співробітниках»). */
function isRecordAttendanceArrived(att: unknown): boolean {
  if (att === 1 || att === 2) return true;
  if (typeof att === 'string') {
    const s = att.toLowerCase().replace(/-/g, '_');
    return (
      s === 'arrived' ||
      s === 'confirmed' ||
      s === 'yes' ||
      s === 'completed' ||
      s === 'success' ||
      s === 'client_came'
    );
  }
  return false;
}

/** Розгортання елемента списку (JSON:API: { id, type, attributes }). */
function unwrapRecordListEntity(raw: any): any {
  if (raw == null || typeof raw !== 'object') return raw;
  const attrs = (raw as any).attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    return { ...attrs, id: (raw as any).id, type: (raw as any).type };
  }
  return raw;
}

function extractRecordAttendanceForMtd(raw: any): unknown {
  return (
    raw?.attendance ??
    raw?.visit_attendance ??
    raw?.visit_status ??
    raw?.record_visit_status ??
    raw?.status ??
    raw?.data?.attendance ??
    raw?.data?.visit_attendance ??
    raw?.data?.visit_status ??
    null
  );
}

/** Чи є хоч один рядок послуги/товару з додатною сумою (після знижки) — для списків без attendance. */
function recordHasPositiveServiceOrGoodsLine(raw: any): boolean {
  const services = raw?.services ?? raw?.data?.services ?? [];
  if (Array.isArray(services)) {
    for (const s of services) {
      if (serviceLineCostAfterDiscount(s) > 0) return true;
    }
  }
  const goodsBlocks = [raw?.goods, raw?.goods_transactions, raw?.data?.goods, raw?.data?.goods_transactions];
  for (const block of goodsBlocks) {
    if (!Array.isArray(block)) continue;
    for (const g of block) {
      if (goodLineCostAfterDiscount(g) > 0) return true;
    }
  }
  return false;
}

/**
 * Для МТД: прийшов за attendance АБО (немає поля attendance у bulk-відповіді, але є фін. рядки).
 * Не рахуємо очікування (0) і no-show (-1) без грошей.
 */
function shouldCountRecordForMtdTurnover(raw: any): boolean {
  if (raw?.deleted === true || raw?.deleted === 1) return false;
  const att = extractRecordAttendanceForMtd(raw);
  if (isRecordAttendanceArrived(att)) return true;
  if (att === 0 || att === -1) return false;
  if (typeof att === 'string') {
    const s = att.toLowerCase().replace(/-/g, '_');
    if (s === 'no_show' || s === 'noshow' || s === 'absent' || s === 'pending' || s === 'waiting') return false;
  }
  if (att == null || att === '') {
    return recordHasPositiveServiceOrGoodsLine(raw);
  }
  return false;
}

function extractRecordStaffId(raw: any): number | null {
  const staff = raw?.staff ?? raw?.data?.staff;
  const id = staff?.id ?? raw?.staff_id ?? raw?.data?.staff_id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Вартість рядка послуги після знижки (узгоджено з Z-звітом / касою Altegio).
 * Важливо: `cost` у списку записів часто до знижки — тому result_cost / paid_sum раніше за cost.
 */
function serviceLineCostAfterDiscount(s: any): number {
  if (s == null || typeof s !== 'object') return 0;
  const rc = s.result_cost ?? s.resultCost;
  if (rc != null && String(rc).trim() !== '') return Math.max(0, parseMoneyString(rc));
  const paid = s.paid_sum ?? s.paidSum;
  if (paid != null && String(paid).trim() !== '') return Math.max(0, parseMoneyString(paid));
  const first = parseMoneyString(s.first_cost ?? s.firstCost ?? 0);
  const disc = parseMoneyString(s.discount ?? 0);
  const netFromFirst = Math.max(0, Math.round((first - disc) * 100) / 100);
  if (first > 0 || disc > 0) return netFromFirst;
  const c = s.cost ?? s.Cost;
  if (c != null && String(c).trim() !== '') return Math.max(0, parseMoneyString(c));
  return netFromFirst;
}

function goodLineCostAfterDiscount(g: any): number {
  if (g == null || typeof g !== 'object') return 0;
  const rc = g.result_cost ?? g.resultCost;
  if (rc != null && String(rc).trim() !== '') return Math.max(0, parseMoneyString(rc));
  const ctp = g.cost_to_pay ?? g.costToPay ?? g.cost_to_pay_amount;
  if (ctp != null && String(ctp).trim() !== '') return Math.max(0, parseMoneyString(ctp));
  const first = parseMoneyString(g.cost_per_unit ?? g.first_cost ?? g.firstCost ?? 0);
  const disc = parseMoneyString(g.discount ?? g.discount_amount ?? 0);
  const netFromFirst = Math.max(0, Math.round((first - disc) * 100) / 100);
  if (first > 0 || disc > 0) return netFromFirst;
  const c = g.cost ?? g.total_cost ?? g.totalCost;
  if (c != null && String(c).trim() !== '') return Math.max(0, parseMoneyString(c));
  return netFromFirst;
}

function addRawRecordTurnoverToMap(raw: any, into: Map<number, number>): void {
  if (!shouldCountRecordForMtdTurnover(raw)) return;

  const defaultStaffId = extractRecordStaffId(raw);
  const services = raw?.services ?? raw?.data?.services ?? [];
  if (Array.isArray(services)) {
    for (const s of services) {
      const sid = Number(s?.staff_id ?? s?.staff?.id ?? s?.master_id ?? s?.masterId);
      const staffForLine = Number.isFinite(sid) && sid > 0 ? sid : defaultStaffId;
      if (!staffForLine) continue;
      const add = serviceLineCostAfterDiscount(s);
      if (add <= 0) continue;
      into.set(staffForLine, Math.round(((into.get(staffForLine) || 0) + add) * 100) / 100);
    }
  }

  const goodsBlocks = [raw?.goods, raw?.goods_transactions, raw?.data?.goods, raw?.data?.goods_transactions];
  for (const block of goodsBlocks) {
    if (!Array.isArray(block)) continue;
    for (const g of block) {
      const sid = Number(g?.staff?.id ?? g?.staff_id ?? g?.master?.id ?? g?.master_id);
      const staffForLine = Number.isFinite(sid) && sid > 0 ? sid : defaultStaffId;
      if (!staffForLine) continue;
      const add = goodLineCostAfterDiscount(g);
      if (add <= 0) continue;
      into.set(staffForLine, Math.round(((into.get(staffForLine) || 0) + add) * 100) / 100);
    }
  }
}

/**
 * GET /records/{location_id}?start_date=&end_date=&page=&count=
 * Сума обороту по staff_id за період (лише attended-візити).
 */
export async function fetchRecordsMtdTurnoverByStaffId(
  locationId: number,
  startDateYmd: string,
  endDateYmd: string,
  opts?: { countPerPage?: number; delayMs?: number; maxPages?: number },
): Promise<RecordsMtdByStaffResult> {
  if (!Number.isFinite(locationId) || locationId <= 0) {
    return { ok: false, reason: 'invalid_location', recordsScanned: 0, pagesFetched: 0 };
  }
  const countPerPage = Math.min(200, Math.max(20, opts?.countPerPage ?? 100));
  const delayMs = Math.max(50, opts?.delayMs ?? 100);
  const maxPages = Math.max(1, opts?.maxPages ?? 200);

  const byStaffId = new Map<number, number>();
  let recordsScanned = 0;
  let pagesFetched = 0;
  let recordsPathUsed: 'records' | 'company_records' | undefined;

  const pathBases: Array<{ key: 'records' | 'company_records'; prefix: string }> = [
    { key: 'records', prefix: `records/${locationId}` },
    { key: 'company_records', prefix: `company/${locationId}/records` },
  ];

  try {
    let activeBaseIdx = 0;

    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams();
      params.set('start_date', startDateYmd);
      params.set('end_date', endDateYmd);
      params.set('count', String(countPerPage));
      params.set('page', String(page));
      const base = pathBases[activeBaseIdx];
      const path = `${base.prefix}?${params.toString()}`;
      const response = await altegioFetch<RecordsApiResponse>(path, { method: 'GET' }, 2, 200, 30000);
      if (response && (response as any).success === false) {
        const msg = String((response as any).meta?.message || 'success=false');
        throw new Error(`records_api:${msg}`);
      }
      const rawList = getRawRecordsArrayFromResponse(response).map(unwrapRecordListEntity);
      pagesFetched += 1;

      if (rawList.length === 0) {
        if (page === 1 && activeBaseIdx === 0 && pathBases.length > 1) {
          console.log('[altegio/records] fetchRecordsMtdTurnoverByStaffId: перша сторінка порожня на records/, пробуємо company/.../records', {
            locationId,
            startDateYmd,
            endDateYmd,
          });
          activeBaseIdx = 1;
          byStaffId.clear();
          recordsScanned = 0;
          pagesFetched = 0;
          page = 0;
          continue;
        }
        break;
      }

      if (recordsPathUsed == null) recordsPathUsed = base.key;

      for (const raw of rawList) {
        recordsScanned += 1;
        addRawRecordTurnoverToMap(raw, byStaffId);
      }

      const totalMeta = response?.meta?.total_count;
      if (rawList.length < countPerPage) break;
      if (totalMeta != null && recordsScanned >= totalMeta) break;

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    console.log('[altegio/records] ✅ fetchRecordsMtdTurnoverByStaffId', {
      locationId,
      startDateYmd,
      endDateYmd,
      recordsScanned,
      pagesFetched,
      distinctStaff: byStaffId.size,
      recordsPathUsed,
    });
    return { ok: true, byStaffId, recordsScanned, pagesFetched, recordsPathUsed };
  } catch (err) {
    const reason =
      err instanceof AltegioHttpError ? `http_${err.status}` : err instanceof Error ? err.message : String(err);
    console.warn('[altegio/records] ⚠️ fetchRecordsMtdTurnoverByStaffId', {
      locationId,
      startDateYmd,
      endDateYmd,
      reason,
      recordsScanned,
      pagesFetched,
    });
    return { ok: false, reason, recordsScanned, pagesFetched };
  }
}
