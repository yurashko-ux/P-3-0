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

/** Сира відповідь API (структура може відрізнятися). */
type RecordsApiResponse = {
  data?: ClientRecord[] | ClientRecord | { records?: ClientRecord[]; data?: ClientRecord[] };
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
