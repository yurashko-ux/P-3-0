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

/**
 * Оборот за період з GET /records/{location_id}: фактична виручка по рядках (як колонки «Сума» у звіті Altegio),
 * тобто result_cost / cost×amount, а не first_cost − discount (щоб не розходження при знижках).
 */
export type RecordsMtdByStaffResult =
  | {
      ok: true;
      /** Фактична виручка по staff_id (сума net по рядках). */
      byStaffId: Map<number, number>;
      /** Довідково: сума first_cost-бази по рядках (до знижки). */
      grossByStaffId: Map<number, number>;
      /** Довідково: сума полів discount по рядках. */
      discountByStaffId: Map<number, number>;
      recordsScanned: number;
      pagesFetched: number;
      /** Один повний обхід пагінації GET /records. */
      httpPasses: 1;
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

/**
 * Для МТД: лише явний «прийшов» у attendance (без евристики «нема поля — рахувати по грошах»),
 * щоб fallback GET /records не завищував оборот проти графіка income_daily в Altegio.
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
  return false;
}

function extractRecordStaffId(raw: any): number | null {
  const staff = raw?.staff ?? raw?.data?.staff;
  const id = staff?.id ?? raw?.staff_id ?? raw?.data?.staff_id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * База до знижки по рядку послуги (GET /records).
 * За документацією Altegio: first_cost — до знижки; discount — сума знижки; cost — підсумок рядка (після знижки).
 * Тому брутто беремо з first_cost×amount; якщо first_cost немає — відновлюємо як result_cost + discount або cost + discount.
 */
function serviceLineGrossListUAH(s: any): number {
  if (s == null || typeof s !== 'object') return 0;
  const amtRaw = s.amount ?? s.quantity ?? 1;
  const amt = typeof amtRaw === 'number' ? amtRaw : parseMoneyString(amtRaw);
  const a = Number.isFinite(amt) && amt > 0 ? amt : 1;
  const fc = parseMoneyString(s.first_cost ?? s.firstCost ?? 0);
  if (fc > 0) {
    return Math.max(0, Math.round(fc * a * 100) / 100);
  }
  const disc = parseMoneyString(s.discount ?? s.discount_sum ?? 0);
  const res = parseMoneyString(s.result_cost ?? s.resultCost ?? 0);
  const c = parseMoneyString(s.cost ?? s.Cost ?? 0);
  const net = res > 0 ? res : c;
  if (net > 0 || disc > 0) {
    return Math.max(0, Math.round((net + disc) * 100) / 100);
  }
  return 0;
}

/** Знижка по рядку послуги (грн). */
function serviceLineDiscountUAH(s: any): number {
  if (s == null || typeof s !== 'object') return 0;
  return Math.max(0, parseMoneyString(s.discount ?? s.discount_sum ?? 0));
}

/**
 * База до знижки по товару (records або visits/search: cost_per_unit без знижки, cost_to_pay — до сплати).
 */
function goodLineGrossListUAH(g: any): number {
  if (g == null || typeof g !== 'object') return 0;
  const qty = Number(g.quantity ?? g.amount ?? g.count ?? 1);
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const cup = parseMoneyString(g.cost_per_unit ?? g.first_cost ?? g.firstCost ?? 0);
  if (cup > 0) return Math.max(0, Math.round(cup * q * 100) / 100);
  const disc = parseMoneyString(g.discount ?? g.discount_amount ?? 0);
  const ctp = parseMoneyString(g.cost_to_pay ?? 0);
  if (ctp > 0 || disc > 0) {
    return Math.max(0, Math.round((ctp + disc) * 100) / 100);
  }
  const total = parseMoneyString(g.cost ?? g.total_cost ?? g.totalCost ?? 0);
  return Math.max(0, total);
}

function goodLineDiscountUAH(g: any): number {
  if (g == null || typeof g !== 'object') return 0;
  return Math.max(0, parseMoneyString(g.discount ?? g.discount_amount ?? 0));
}

/**
 * Фактична виручка по рядку послуги — те саме джерело, що й у звіті «Виручка» (після знижки).
 * Пріоритет: result_cost (підсумок рядка) → cost×amount як у вебхуках → first_cost×amount − discount.
 */
function serviceLineNetTurnoverUAH(s: any): number {
  if (s == null || typeof s !== 'object') return 0;
  const res = parseMoneyString(s.result_cost ?? s.resultCost ?? 0);
  if (res > 0) return Math.max(0, res);
  const amtRaw = s.amount ?? s.quantity ?? 1;
  const amt = typeof amtRaw === 'number' ? amtRaw : parseMoneyString(amtRaw);
  const a = Number.isFinite(amt) && amt > 0 ? amt : 1;
  const c = parseMoneyString(s.cost ?? s.Cost ?? 0);
  if (c > 0) return Math.max(0, Math.round(c * a * 100) / 100);
  const fc = parseMoneyString(s.first_cost ?? s.firstCost ?? 0);
  const disc = parseMoneyString(s.discount ?? s.discount_sum ?? 0);
  if (fc > 0 || disc > 0) return Math.max(0, Math.round((fc * a - disc) * 100) / 100);
  return 0;
}

/** Фактична виручка по товару (після знижки). */
function goodLineNetTurnoverUAH(g: any): number {
  if (g == null || typeof g !== 'object') return 0;
  const ctp = parseMoneyString(g.cost_to_pay ?? 0);
  if (ctp > 0) return Math.max(0, ctp);
  const qty = Number(g.quantity ?? g.amount ?? g.count ?? 1);
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const total = parseMoneyString(g.cost ?? g.total_cost ?? g.totalCost ?? 0);
  if (total > 0) return Math.max(0, total);
  const cup = parseMoneyString(g.cost_per_unit ?? g.first_cost ?? g.firstCost ?? 0);
  const disc = parseMoneyString(g.discount ?? g.discount_amount ?? 0);
  if (cup > 0) return Math.max(0, Math.round((cup * q - disc) * 100) / 100);
  return 0;
}

/** Один прохід запису: фактична виручка (net), довідково брутто та знижки. */
function addRawRecordMtdMaps(
  raw: any,
  netInto: Map<number, number>,
  grossInto: Map<number, number>,
  discountInto: Map<number, number>,
): void {
  if (!shouldCountRecordForMtdTurnover(raw)) return;
  const defaultStaffId = extractRecordStaffId(raw);
  const services = raw?.services ?? raw?.data?.services ?? [];
  if (Array.isArray(services)) {
    for (const s of services) {
      const sid = Number(s?.staff_id ?? s?.staff?.id ?? s?.master_id ?? s?.masterId);
      const staffForLine = Number.isFinite(sid) && sid > 0 ? sid : defaultStaffId;
      if (!staffForLine) continue;
      const net = serviceLineNetTurnoverUAH(s);
      if (net > 0) {
        netInto.set(staffForLine, Math.round(((netInto.get(staffForLine) || 0) + net) * 100) / 100);
      }
      const g = serviceLineGrossListUAH(s);
      if (g > 0) {
        grossInto.set(staffForLine, Math.round(((grossInto.get(staffForLine) || 0) + g) * 100) / 100);
      }
      const d = serviceLineDiscountUAH(s);
      if (d > 0) {
        discountInto.set(staffForLine, Math.round(((discountInto.get(staffForLine) || 0) + d) * 100) / 100);
      }
    }
  }
  const goodsBlocks = [raw?.goods, raw?.goods_transactions, raw?.data?.goods, raw?.data?.goods_transactions];
  for (const block of goodsBlocks) {
    if (!Array.isArray(block)) continue;
    for (const g of block) {
      const sid = Number(g?.staff?.id ?? g?.staff_id ?? g?.master?.id ?? g?.master_id);
      const staffForLine = Number.isFinite(sid) && sid > 0 ? sid : defaultStaffId;
      if (!staffForLine) continue;
      const net = goodLineNetTurnoverUAH(g);
      if (net > 0) {
        netInto.set(staffForLine, Math.round(((netInto.get(staffForLine) || 0) + net) * 100) / 100);
      }
      const gr = goodLineGrossListUAH(g);
      if (gr > 0) {
        grossInto.set(staffForLine, Math.round(((grossInto.get(staffForLine) || 0) + gr) * 100) / 100);
      }
      const d = goodLineDiscountUAH(g);
      if (d > 0) {
        discountInto.set(staffForLine, Math.round(((discountInto.get(staffForLine) || 0) + d) * 100) / 100);
      }
    }
  }
}

/**
 * Один повний обхід GET /records (пагінація) з накопиченням у `into` через `addRaw`.
 */
async function runRecordsMtdSingleHttpPass(
  locationId: number,
  startDateYmd: string,
  endDateYmd: string,
  countPerPage: number,
  delayMs: number,
  maxPages: number,
  passLabel: 'gross' | 'discount' | 'mtd',
  addRaw: (raw: any, into: Map<number, number>) => void,
  into: Map<number, number>,
  /** При перемиканні records → company/records очистити всі накопичувачі (для одного проходу з кількома map). */
  onRetrySwitchPathClear?: () => void,
): Promise<{ recordsScanned: number; pagesFetched: number; recordsPathUsed?: 'records' | 'company_records' }> {
  let recordsScanned = 0;
  let pagesFetched = 0;
  let recordsPathUsed: 'records' | 'company_records' | undefined;
  const pathBases: Array<{ key: 'records' | 'company_records'; prefix: string }> = [
    { key: 'records', prefix: `records/${locationId}` },
    { key: 'company_records', prefix: `company/${locationId}/records` },
  ];
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
        console.log('[altegio/records] runRecordsMtdSingleHttpPass: порожня перша сторінка records/, пробуємо company/records', {
          locationId,
          startDateYmd,
          endDateYmd,
          passLabel,
        });
        activeBaseIdx = 1;
        if (onRetrySwitchPathClear) onRetrySwitchPathClear();
        else into.clear();
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
      addRaw(raw, into);
    }

    const totalMeta = response?.meta?.total_count;
    if (rawList.length < countPerPage) break;
    if (totalMeta != null && recordsScanned >= totalMeta) break;

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return { recordsScanned, pagesFetched, recordsPathUsed };
}

/**
 * GET /records/{location_id}?start_date=&end_date=&page=&count=
 * Один обхід: фактична виручка по рядках (result_cost / cost×amount), лише attended-візити.
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

  let recordsScannedTotal = 0;
  let pagesFetchedTotal = 0;

  try {
    const byStaffId = new Map<number, number>();
    const grossByStaffId = new Map<number, number>();
    const discountByStaffId = new Map<number, number>();
    const pass1 = await runRecordsMtdSingleHttpPass(
      locationId,
      startDateYmd,
      endDateYmd,
      countPerPage,
      delayMs,
      maxPages,
      'mtd',
      (raw) => addRawRecordMtdMaps(raw, byStaffId, grossByStaffId, discountByStaffId),
      byStaffId,
      () => {
        byStaffId.clear();
        grossByStaffId.clear();
        discountByStaffId.clear();
      },
    );
    recordsScannedTotal += pass1.recordsScanned;
    pagesFetchedTotal += pass1.pagesFetched;

    const recordsPathUsed = pass1.recordsPathUsed;

    console.log('[altegio/records] ✅ fetchRecordsMtdTurnoverByStaffId (фактична виручка по рядках, 1 прохід)', {
      locationId,
      startDateYmd,
      endDateYmd,
      recordsScannedTotal,
      pagesFetchedTotal,
      distinctStaffNet: byStaffId.size,
      recordsPathUsed,
    });
    return {
      ok: true,
      byStaffId,
      grossByStaffId,
      discountByStaffId,
      recordsScanned: recordsScannedTotal,
      pagesFetched: pagesFetchedTotal,
      httpPasses: 1,
      recordsPathUsed,
    };
  } catch (err) {
    const reason =
      err instanceof AltegioHttpError ? `http_${err.status}` : err instanceof Error ? err.message : String(err);
    console.warn('[altegio/records] ⚠️ fetchRecordsMtdTurnoverByStaffId', {
      locationId,
      startDateYmd,
      endDateYmd,
      reason,
      recordsScanned: recordsScannedTotal,
      pagesFetched: pagesFetchedTotal,
    });
    return { ok: false, reason, recordsScanned: recordsScannedTotal, pagesFetched: pagesFetchedTotal };
  }
}
