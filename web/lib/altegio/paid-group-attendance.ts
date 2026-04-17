// web/lib/altegio/paid-group-attendance.ts
// Те саме джерело, що й GET /api/admin/direct/record-history (type=paid): групування по днях + computeAttendanceForGroup.

import { kvRead } from '@/lib/kv';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickClosestPaidGroup,
} from '@/lib/altegio/records-grouping';

/**
 * Повертає агрегований attendance для платного запису на дату paidServiceDate (як у модалці історії).
 * Не використовує «останній запис» з getClientRecords без групування — там губиться 1 vs 2 при кількох подіях у день.
 */
export async function resolvePaidAttendanceForPaidServiceDate(params: {
  companyId: number;
  altegioClientId: number;
  /** ISO або те, що їсть у direct_clients.paidServiceDate */
  paidServiceDateIso: string;
}): Promise<{ attendance: number | null; attendanceSetAt: string | null } | null> {
  const { companyId, altegioClientId, paidServiceDateIso } = params;

  let itemsForNormalize: any[] = [];
  try {
    const rawRecords = await getClientRecordsRaw(companyId, altegioClientId);
    if (rawRecords.length > 0) {
      itemsForNormalize = rawRecords
        .filter((r: any) => !r?.deleted)
        .map((r: any) => rawRecordToRecordEvent(r, altegioClientId, companyId));
    }
  } catch (e) {
    console.warn('[paid-group-attendance] getClientRecordsRaw failed, fallback KV:', e);
  }

  if (itemsForNormalize.length === 0) {
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    itemsForNormalize = [...rawItemsRecords, ...rawItemsWebhook];
  }

  const normalizedEvents = normalizeRecordsLogItems(itemsForNormalize);
  const groupsByClient = groupRecordsByClientDay(normalizedEvents);
  const groups = groupsByClient.get(altegioClientId) || [];
  const paidGroup = pickClosestPaidGroup(groups, paidServiceDateIso);
  if (!paidGroup || paidGroup.groupType !== 'paid') return null;

  return {
    attendance: paidGroup.attendance,
    attendanceSetAt: paidGroup.attendanceSetAt ?? null,
  };
}
