import { AltegioHttpError, altegioFetch } from './client';

export type RecordPaymentTransaction = {
  transactionId: number | null;
  recordId: number;
  amount: number;
  date: string | null;
  deleted: boolean;
  staffId: number | null;
  staffName: string;
};

function extractArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const payload = raw as Record<string, unknown>;
  if (Array.isArray(payload.data)) return payload.data as any[];
  if (Array.isArray(payload.transactions)) return payload.transactions as any[];
  if (Array.isArray(payload.items)) return payload.items as any[];

  const nestedData = payload.data;
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    const nested = nestedData as Record<string, unknown>;
    if (Array.isArray(nested.transactions)) return nested.transactions as any[];
    if (Array.isArray(nested.items)) return nested.items as any[];
  }

  return [];
}

function toId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.').trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  }
  return 0;
}

function normalizeName(value: unknown): string {
  return String(value || '').trim();
}

function pickTransactionAmountRaw(raw: any): unknown {
  return (
    raw?.amount ??
    raw?.sum ??
    raw?.value ??
    raw?.payment_amount ??
    raw?.paid_sum ??
    raw?.sum_paid ??
    raw?.total ??
    raw?.price ??
    raw?.cost
  );
}

function normalizeTransaction(recordId: number, raw: any): RecordPaymentTransaction {
  const transactionId = toId(raw?.id ?? raw?.transaction_id ?? raw?.payment_id);
  const amount = toMoney(pickTransactionAmountRaw(raw));
  const date = raw?.date ?? raw?.created_at ?? raw?.datetime ?? null;
  const deleted = raw?.deleted === true || raw?.deleted === 1 || raw?.is_deleted === true || raw?.is_deleted === 1;
  const staffId =
    toId(raw?.staff_id) ??
    toId(raw?.master_id) ??
    toId(raw?.employee_id) ??
    toId(raw?.staff?.id) ??
    toId(raw?.master?.id) ??
    null;
  const staffName = normalizeName(
    raw?.staff?.title ??
      raw?.staff?.name ??
      raw?.master?.title ??
      raw?.master?.name ??
      raw?.employee?.title ??
      raw?.employee?.name ??
      raw?.staff_name ??
      raw?.master_name ??
      raw?.employee_name
  );

  return {
    transactionId,
    recordId,
    amount,
    date: date ? String(date) : null,
    deleted,
    staffId,
    staffName,
  };
}

export async function fetchTimetableTransactionsForRecord(
  locationId: number,
  recordId: number
): Promise<RecordPaymentTransaction[]> {
  if (!Number.isFinite(locationId) || locationId <= 0 || !Number.isFinite(recordId) || recordId <= 0) {
    return [];
  }

  const path = `timetable/transactions/${locationId}?record_id=${recordId}`;

  try {
    const raw = await altegioFetch<any>(path, { method: 'GET' }, 2, 200, 20000);
    const rawList = extractArray(raw);
    const normalized = rawList.map((item) => normalizeTransaction(recordId, item));
    if (rawList.length > 0 && !normalized.some((t) => !t.deleted && t.amount > 0)) {
      const sample = rawList[0];
      console.warn('[altegio/record-payments] ⚠️ Є транзакції по record_id, але сума після парсингу 0 — перевірте поля відповіді Altegio', {
        locationId,
        recordId,
        sampleKeys: sample && typeof sample === 'object' ? Object.keys(sample as object) : [],
      });
    }
    return normalized;
  } catch (error) {
    if (error instanceof AltegioHttpError && error.status === 404) {
      return [];
    }
    console.warn('[altegio/record-payments] ⚠️ Не вдалося отримати платежі по record_id:', {
      locationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function fetchTimetableTransactionsForRecordIds(
  locationId: number,
  recordIds: number[],
  options?: { concurrency?: number }
): Promise<Map<number, RecordPaymentTransaction[]>> {
  const uniqueRecordIds = Array.from(
    new Set(
      recordIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  const results = new Map<number, RecordPaymentTransaction[]>();
  if (uniqueRecordIds.length === 0) return results;

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, 8));
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= uniqueRecordIds.length) return;

      const recordId = uniqueRecordIds[currentIndex];
      const transactions = await fetchTimetableTransactionsForRecord(locationId, recordId);
      results.set(recordId, transactions);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueRecordIds.length) }, () => worker()));

  console.log('[altegio/record-payments] ✅ Завантажено платежі по record_id', {
    locationId,
    recordIds: uniqueRecordIds.length,
    withTransactions: Array.from(results.values()).filter((items) => items.length > 0).length,
  });

  return results;
}

export type RecordPaymentState = {
  /** Запис оплачено повністю (paid_full). */
  paidFull: boolean;
  /** Оплата почата, але не повна. */
  paidPartially: boolean;
  /** Послуги + товари запису. */
  total: number;
  servicesTotal: number;
  /** Товари Altegio належать візиту: при кількох майстрах однакові в кожному записі. */
  goodsTotal: number;
  services: Array<{ id: number; cost: number }>;
};

/**
 * Стан оплати з картки запису. timetable/transactions віддає порожньо навіть для оплачених записів,
 * а GET /record містить paid_full, payment_status і ціни послуг.
 */
export async function fetchRecordPaymentState(
  locationId: number,
  recordId: number
): Promise<RecordPaymentState | null> {
  if (!Number.isFinite(locationId) || locationId <= 0 || !Number.isFinite(recordId) || recordId <= 0) {
    return null;
  }
  try {
    const raw = await altegioFetch<any>(`/record/${locationId}/${recordId}`, { method: 'GET' }, 2, 200, 20000);
    const data = raw?.data ?? raw;
    if (!data || typeof data !== 'object') return null;
    const services = (Array.isArray(data.services) ? data.services : [])
      .map((s: any) => ({ id: Number(s?.id) || 0, cost: toMoney(s?.cost ?? s?.first_cost) }))
      .filter((s: { id: number }) => s.id > 0);
    const goods = Array.isArray(data.goods_transactions) ? data.goods_transactions : [];
    const goodsTotal = goods.reduce((sum: number, g: any) => sum + Math.abs(toMoney(g?.cost)), 0);
    const servicesTotal = services.reduce((sum: number, s: { cost: number }) => sum + s.cost, 0);
    const paidFull = Number(data.paid_full) === 1;
    return {
      paidFull,
      paidPartially: !paidFull && Number(data.payment_status) > 0,
      total: toMoney(servicesTotal + goodsTotal),
      servicesTotal: toMoney(servicesTotal),
      goodsTotal: toMoney(goodsTotal),
      services,
    };
  } catch (error) {
    console.warn('[altegio/record-payments] ⚠️ Не вдалося прочитати стан оплати запису:', {
      locationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
