// web/lib/altegio/mtd-discount.ts
// Fallback знижок МТД, коли Z-звіт недоступний: GET /records (Σ services.discount) + GET /storages/transactions (Σ discount).
// Основне джерело в masters-stats — discount з Z-звіту (як колонка «Знижка» у звіті Altegio).

import { fetchRecordsMtdTurnoverByStaffId, type RecordsMtdByStaffResult } from './records';
import { fetchStoragesTransactionsDiscountByStaffId } from './storages-discount';

export type MtdDiscountFetchResult = {
  /** Σ discount по рядках services у записах (GET /records). */
  servicesDiscountByStaffId: Map<number, number>;
  /** Σ discount по складських транзакціях (GET /storages/transactions). */
  storageDiscountByStaffId: Map<number, number>;
  recordsOk: boolean;
  recordsScanned: number;
  recordsReason?: string;
};

type RecordsMtdOk = Extract<RecordsMtdByStaffResult, { ok: true }>;

/**
 * Завантаження знижок за період; сума по майстру = services + storage.
 * Якщо передано `reuseRecordsIfOk` (наприклад після fallback GET /records у masters-stats) — не дублюємо запит до /records.
 */
export async function fetchMtdDiscountSourcesByStaffId(
  locationId: number,
  startDateYmd: string,
  endDateYmd: string,
  opts?: { countPerPage?: number; delayMs?: number; maxPages?: number },
  reuseRecordsIfOk?: RecordsMtdOk | null,
): Promise<MtdDiscountFetchResult> {
  if (reuseRecordsIfOk != null) {
    const storageDiscountByStaffId = await fetchStoragesTransactionsDiscountByStaffId(
      locationId,
      startDateYmd,
      endDateYmd,
    );
    return {
      servicesDiscountByStaffId: reuseRecordsIfOk.discountByStaffId,
      storageDiscountByStaffId,
      recordsOk: true,
      recordsScanned: reuseRecordsIfOk.recordsScanned,
    };
  }

  const [rec, storageDiscountByStaffId] = await Promise.all([
    fetchRecordsMtdTurnoverByStaffId(locationId, startDateYmd, endDateYmd, opts),
    fetchStoragesTransactionsDiscountByStaffId(locationId, startDateYmd, endDateYmd),
  ]);

  if (!rec.ok) {
    const fail = rec;
    return {
      servicesDiscountByStaffId: new Map(),
      storageDiscountByStaffId,
      recordsOk: false,
      recordsScanned: fail.recordsScanned,
      recordsReason: fail.ok === false ? fail.reason : undefined,
    };
  }

  return {
    servicesDiscountByStaffId: rec.discountByStaffId,
    storageDiscountByStaffId,
    recordsOk: true,
    recordsScanned: rec.recordsScanned,
  };
}
