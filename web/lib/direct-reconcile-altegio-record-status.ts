/**
 * Вирівнювання полів direct_clients (платний запис / консультація) з фактичними групами Altegio.
 * Спільна логіка для GET record-history та фонового reconcile після завантаження таблиці.
 */

import { kvRead } from '@/lib/kv';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import {
  computeServicesTotalCostUAH,
  groupRecordsByClientDay,
  isNonConsultantStaffName,
  kyivDayFromISO,
  normalizeRecordsLogItems,
  pickConsultStaffFromGroup,
  pickRecordStaffFromGroups,
} from '@/lib/altegio/records-grouping';
import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';

export type RecordHistoryApiRow = {
  kyivDay: string;
  type: 'paid' | 'consultation';
  datetime: string | null;
  createdAt: string | null;
  receivedAt: string | null;
  attendanceSetAt: string | null;
  attendance: number | null;
  attendanceStatus: string;
  attendanceIcon: string;
  attendanceIconVariant?: 'green' | 'blue' | null;
  attendanceLabel: string;
  staffNames: string[];
  services: string[];
  totalCost: number;
  rawEventsCount: number;
  events: Array<{
    receivedAt: string | null;
    datetime: string | null;
    staffName: string | null;
    attendance: number | null;
    status?: string | null;
    visitId: number | null;
  }>;
};

function attendanceUi(attendance: number | null, status: string) {
  if (attendance === 1) return { icon: '✅', label: 'Прийшов', variant: 'green' as const };
  if (attendance === 2) return { icon: '✅', label: 'Підтвердив запис', variant: 'blue' as const };
  if (attendance === -2 || status === 'cancelled') return { icon: '🚫', label: 'Скасовано', variant: null };
  if (attendance === -1) return { icon: '❌', label: "Не з'явився", variant: null };
  if (attendance === 0) return { icon: '⏳', label: 'Очікується', variant: null };
  return { icon: '❓', label: 'Невідомо', variant: null };
}

export function mapAltegioGroupToApiRow(g: {
  kyivDay: string;
  groupType: 'paid' | 'consultation';
  datetime: string | null;
  receivedAt: string | null;
  attendanceSetAt?: string | null;
  attendance: number | null;
  attendanceStatus: string;
  staffNames: string[];
  services: unknown[];
  events: unknown[];
}): RecordHistoryApiRow {
  const recordCreatedAt = (() => {
    try {
      const events = Array.isArray((g as any)?.events) ? (g as any).events : [];
      const toTs = (e: any) => new Date(e?.create_date ?? e?.receivedAt ?? e?.datetime ?? 0).getTime();

      let bestCreate = Infinity;
      for (const e of events) {
        const status = (e?.status || '').toString();
        if (status !== 'create') continue;
        const ts = toTs(e);
        if (isFinite(ts) && ts < bestCreate) bestCreate = ts;
      }
      if (bestCreate !== Infinity) return new Date(bestCreate).toISOString();

      let bestAny = Infinity;
      for (const e of events) {
        const ts = toTs(e);
        if (isFinite(ts) && ts < bestAny) bestAny = ts;
      }
      if (bestAny !== Infinity) return new Date(bestAny).toISOString();

      return null;
    } catch {
      return null;
    }
  })();

  const ui = attendanceUi(g.attendance, g.attendanceStatus);
  const totalCost = computeServicesTotalCostUAH((g.services || []) as any);
  return {
    kyivDay: g.kyivDay,
    type: g.groupType,
    datetime: g.datetime,
    createdAt: recordCreatedAt,
    receivedAt: g.receivedAt,
    attendanceSetAt: g.attendanceSetAt ?? null,
    attendance: g.attendance,
    attendanceStatus: g.attendanceStatus,
    attendanceIcon: ui.icon,
    attendanceIconVariant: ui.variant,
    attendanceLabel: ui.label,
    staffNames: g.staffNames,
    services: (g.services || []).map((s: any) => (s?.title || s?.name || 'Невідома послуга').toString()),
    totalCost,
    rawEventsCount: (g.events || []).length,
    events: ((g.events || []) as any[]).slice(0, 50).map((e) => ({
      receivedAt: e.receivedAt,
      datetime: e.datetime,
      staffName: e.staffName,
      attendance: e.attendance,
      status: e.status,
      visitId: e.visitId,
    })),
  };
}

/** Завантажує нормалізовані групи записів клієнта (API Altegio → інакше KV). */
export async function loadAltegioRecordGroupsForClient(altegioClientId: number): Promise<{
  allGroups: any[];
  dataSource: 'api' | 'kv';
  recordsLogCount: number;
  webhookLogCount: number;
  normalizedCount: number;
}> {
  let itemsForNormalize: any[] = [];
  let dataSource: 'api' | 'kv' = 'kv';
  let recordsLogCount = 0;
  let webhookLogCount = 0;
  const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
  const companyId = companyIdStr ? parseInt(companyIdStr, 10) : NaN;

  if (Number.isFinite(companyId) && companyId > 0) {
    try {
      const rawRecords = await getClientRecordsRaw(companyId, altegioClientId);
      if (rawRecords.length > 0) {
        const eventsFromApi = rawRecords
          .filter((r: any) => !r?.deleted)
          .map((r: any) => rawRecordToRecordEvent(r, altegioClientId, companyId));
        itemsForNormalize = eventsFromApi;
        dataSource = 'api';
      }
    } catch (err) {
      console.warn('[direct-reconcile] ⚠️ API failed, fallback to KV:', err instanceof Error ? err.message : String(err));
    }
  }

  if (itemsForNormalize.length === 0) {
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    recordsLogCount = rawItemsRecords.length;
    webhookLogCount = rawItemsWebhook.length;
    itemsForNormalize = [...rawItemsRecords, ...rawItemsWebhook];
  }

  const normalizedEvents = normalizeRecordsLogItems(itemsForNormalize);
  const groupsByClient = groupRecordsByClientDay(normalizedEvents);
  const allGroups = groupsByClient.get(altegioClientId) || [];

  return {
    allGroups,
    dataSource,
    recordsLogCount,
    webhookLogCount,
    normalizedCount: normalizedEvents.length,
  };
}

export type SelfHealFromGroupsResult = {
  selfHealedPaidAttendance: boolean;
  selfHealedPaidDates: boolean;
  selfHealedLastVisitAt: boolean;
  selfHealedConsultationAttendance: boolean;
  selfHealedConsultationDates: boolean;
};

/** Канонічний платний запис для direct_clients: найближчий майбутній, інакше найновіший. */
function pickCanonicalPaidGroup(
  paidGroups: Array<{
    kyivDay: string;
    datetime: string | null;
    attendance: number | null;
    attendanceStatus: string;
  }>,
  todayKyiv: string
): (typeof paidGroups)[number] | null {
  if (paidGroups.length === 0) return null;
  const future = paidGroups
    .filter(
      (g) =>
        g.kyivDay > todayKyiv &&
        g.attendance !== -2 &&
        g.attendanceStatus !== 'cancelled'
    )
    .sort((a, b) => a.kyivDay.localeCompare(b.kyivDay));
  if (future.length > 0) return future[0];
  return paidGroups[0];
}

/** Останній минулий платний візит (attendance=1) — для lastVisitAt і колонки «Днів». */
function pickLatestPastArrivedPaidGroup(
  paidGroups: Array<{
    kyivDay: string;
    datetime: string | null;
    attendance: number | null;
    attendanceStatus: string;
  }>,
  todayKyiv: string
): (typeof paidGroups)[number] | null {
  const past = paidGroups
    .filter(
      (g) =>
        g.kyivDay <= todayKyiv &&
        g.attendance === 1 &&
        g.attendanceStatus !== 'cancelled'
    )
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  return past[0] ?? null;
}

/**
 * Оновлює Prisma-поля attendance/дат консультації з узгоджених груп (як у модалці історії).
 * Включає гілку attendance=0 (Очікується), щоб скинути застарілі прапорці після нового запису.
 */
export async function prismaSelfHealDirectClientFromRecordGroups(
  altegioClientId: number,
  allGroups: any[]
): Promise<SelfHealFromGroupsResult> {
  const mapGroupToRow = (g: (typeof allGroups)[number]) => mapAltegioGroupToApiRow(g);
  const consultationRows = allGroups.filter((g) => g.groupType === 'consultation').map(mapGroupToRow);

  let selfHealedPaidAttendance = false;
  let selfHealedPaidDates = false;
  let selfHealedLastVisitAt = false;
  let selfHealedConsultationAttendance = false;
  let selfHealedConsultationDates = false;

  const paidGroups = allGroups.filter((g) => g.groupType === 'paid');
  if (paidGroups.length > 0) {
    try {
      const dc = await prisma.directClient.findFirst({
        where: { altegioClientId },
        select: {
          id: true,
          paidServiceDate: true,
          paidServiceKyivDay: true,
          paidServiceRecordCreatedAt: true,
          paidServiceTotalCost: true,
          paidServiceAttendanceValue: true,
          paidServiceAttended: true,
          paidServiceCancelled: true,
          signedUpForPaidService: true,
          serviceMasterName: true,
          serviceMasterAltegioStaffId: true,
          lastVisitAt: true,
        },
      });
      if (dc) {
        const todayKyiv = kyivDayFromISO(new Date().toISOString());
        const canonicalGroup = pickCanonicalPaidGroup(paidGroups, todayKyiv);
        if (canonicalGroup) {
          const target = mapGroupToRow(canonicalGroup);
          const att = target.attendance;
          const updates: Record<string, unknown> = {};

          const canonicalIso = canonicalGroup.datetime
            ? new Date(canonicalGroup.datetime).toISOString()
            : null;
          const canonicalKyiv = canonicalGroup.kyivDay;

          const dbIso = dc.paidServiceDate
            ? typeof dc.paidServiceDate === 'string'
              ? dc.paidServiceDate
              : dc.paidServiceDate instanceof Date
                ? dc.paidServiceDate.toISOString()
                : String(dc.paidServiceDate)
            : '';
          const dbKyiv = (dc.paidServiceKyivDay || '').trim() || (dbIso ? kyivDayFromISO(dbIso) : '');

          if (canonicalIso && (dbKyiv !== canonicalKyiv || dbIso !== canonicalIso)) {
            updates.paidServiceDate = new Date(canonicalIso);
            updates.paidServiceKyivDay = canonicalKyiv;
            updates.signedUpForPaidService = true;
            (updates as { paidServiceDeletedInAltegio?: boolean }).paidServiceDeletedInAltegio = false;
            selfHealedPaidDates = true;
            console.log('[direct-reconcile] ✅ Self-heal paidServiceDate', {
              altegioClientId,
              from: dbKyiv || '—',
              to: canonicalKyiv,
            });
          } else if (!dc.signedUpForPaidService && canonicalIso) {
            updates.signedUpForPaidService = true;
          }

          const paidIsoForStaff = canonicalIso || dbIso;
          const staffPick =
            pickRecordStaffFromGroups(allGroups, paidIsoForStaff, null) ??
            pickConsultStaffFromGroup(canonicalGroup as Parameters<typeof pickConsultStaffFromGroup>[0]);
          const currentMaster = (dc.serviceMasterName || '').trim();
          if (
            staffPick?.staffName?.trim() &&
            !isNonConsultantStaffName(staffPick.staffName) &&
            (!currentMaster || isNonConsultantStaffName(currentMaster))
          ) {
            updates.serviceMasterName = staffPick.staffName.trim();
            if (staffPick.staffId != null) {
              updates.serviceMasterAltegioStaffId = staffPick.staffId;
            }
          }

          if (!dc.paidServiceRecordCreatedAt && target.createdAt) {
            updates.paidServiceRecordCreatedAt = new Date(target.createdAt);
          }
          if ((dc.paidServiceTotalCost ?? 0) <= 0 && (target.totalCost ?? 0) > 0) {
            updates.paidServiceTotalCost = target.totalCost;
          }

          if (att === 1 || att === 2) {
            if ((dc.paidServiceAttendanceValue ?? null) !== att) {
              updates.paidServiceAttendanceValue = att;
            }
            if (dc.paidServiceAttended !== true) updates.paidServiceAttended = true;
            if (dc.paidServiceCancelled) updates.paidServiceCancelled = false;
            if (target.attendanceSetAt) {
              updates.paidServiceAttendanceSetAt = new Date(target.attendanceSetAt);
            }
          } else if (att === -1) {
            if (dc.paidServiceAttended !== false) {
              updates.paidServiceAttended = false;
              updates.paidServiceAttendanceValue = null;
            }
          } else if (att === -2 || String(target.attendanceStatus || '') === 'cancelled') {
            if (!dc.paidServiceCancelled) {
              updates.paidServiceCancelled = true;
              updates.paidServiceAttended = null;
              updates.paidServiceAttendanceValue = null;
            }
          } else if (att === 0) {
            if (dc.paidServiceAttended !== null && dc.paidServiceAttended !== undefined) {
              updates.paidServiceAttended = null;
            }
            if (dc.paidServiceAttendanceValue != null) {
              updates.paidServiceAttendanceValue = null;
            }
            if (dc.paidServiceCancelled) {
              updates.paidServiceCancelled = false;
            }
            if (target.attendanceSetAt) {
              updates.paidServiceAttendanceSetAt = new Date(target.attendanceSetAt);
            }
          }

          const pastArrived = pickLatestPastArrivedPaidGroup(paidGroups, todayKyiv);
          if (pastArrived?.datetime) {
            const pastIso = new Date(pastArrived.datetime).toISOString();
            const pastKyiv = pastArrived.kyivDay;
            const dbLastIso = dc.lastVisitAt
              ? typeof dc.lastVisitAt === 'string'
                ? dc.lastVisitAt
                : dc.lastVisitAt instanceof Date
                  ? dc.lastVisitAt.toISOString()
                  : String(dc.lastVisitAt)
              : '';
            const dbLastKyiv = dbLastIso ? kyivDayFromISO(dbLastIso) : '';
            if (!dbLastKyiv || pastKyiv > dbLastKyiv) {
              updates.lastVisitAt = new Date(pastIso);
              selfHealedLastVisitAt = true;
              console.log('[direct-reconcile] ✅ Self-heal lastVisitAt', {
                altegioClientId,
                from: dbLastKyiv || '—',
                to: pastKyiv,
              });
            }
          }

          if (Object.keys(updates).length > 0) {
            await prisma.directClient.update({ where: { id: dc.id }, data: updates as any });
            selfHealedPaidAttendance = true;
            console.log('[direct-reconcile] ✅ Self-heal paid record', {
              altegioClientId,
              attendance: att,
              kyivDay: canonicalKyiv,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[direct-reconcile] ⚠️ paid self-heal:', err);
    }
  }

  if (consultationRows.length > 0) {
    try {
      const dc = await prisma.directClient.findFirst({
        where: { altegioClientId },
        select: {
          id: true,
          consultationBookingDate: true,
          consultationBookingKyivDay: true,
          consultationAttendanceValue: true,
          consultationAttended: true,
          consultationCancelled: true,
        },
      });
      if (dc?.consultationBookingDate) {
        const consultIso =
          typeof dc.consultationBookingDate === 'string'
            ? dc.consultationBookingDate
            : dc.consultationBookingDate instanceof Date
              ? dc.consultationBookingDate.toISOString()
              : String(dc.consultationBookingDate);
        const consultKyiv = dc.consultationBookingKyivDay || kyivDayFromISO(consultIso);
        const rowForDay = consultKyiv ? consultationRows.find((r) => r.kyivDay === consultKyiv) : null;
        const target = rowForDay ?? consultationRows[0];
        const att = target.attendance;
        const updates: Record<string, unknown> = {};

        if (att === 1 || att === 2) {
          if ((dc.consultationAttendanceValue ?? null) !== att) {
            updates.consultationAttendanceValue = att;
          }
          if (dc.consultationAttended !== true) updates.consultationAttended = true;
          if (dc.consultationCancelled) updates.consultationCancelled = false;
          if (target.attendanceSetAt) {
            updates.consultationAttendanceSetAt = new Date(target.attendanceSetAt);
          }
        } else if (att === -1) {
          if (dc.consultationAttended !== false) {
            updates.consultationAttended = false;
            updates.consultationAttendanceValue = null;
          }
        } else if (att === -2 || String(target.attendanceStatus || '') === 'cancelled') {
          if (!dc.consultationCancelled) {
            updates.consultationCancelled = true;
            updates.consultationAttended = null;
            updates.consultationAttendanceValue = null;
          }
        } else if (att === 0) {
          if (dc.consultationAttended !== null && dc.consultationAttended !== undefined) {
            updates.consultationAttended = null;
          }
          if (dc.consultationAttendanceValue != null) {
            updates.consultationAttendanceValue = null;
          }
          if (dc.consultationCancelled) {
            updates.consultationCancelled = false;
          }
          if (target.attendanceSetAt) {
            updates.consultationAttendanceSetAt = new Date(target.attendanceSetAt);
          }
        }

        if (Object.keys(updates).length > 0) {
          await prisma.directClient.update({ where: { id: dc.id }, data: updates as any });
          selfHealedConsultationAttendance = true;
          console.log('[direct-reconcile] ✅ Self-heal consultation attendance', { altegioClientId, attendance: att, consultKyiv });
        }
      }
    } catch (err) {
      console.warn('[direct-reconcile] ⚠️ consultation attendance self-heal:', err);
    }
  }

  if (consultationRows.length > 0) {
    try {
      const latestRow = consultationRows[0];
      const latestBookingDate = latestRow.datetime ? new Date(latestRow.datetime).toISOString() : null;
      const latestCreatedAt = latestRow.createdAt ? new Date(latestRow.createdAt).toISOString() : null;
      const directClient = await prisma.directClient.findFirst({
        where: { altegioClientId },
        select: {
          id: true,
          consultationBookingDate: true,
          consultationRecordCreatedAt: true,
        },
      });
      if (directClient) {
        const updates: Record<string, Date> = {};
        if (
          latestBookingDate &&
          (!directClient.consultationBookingDate ||
            new Date(directClient.consultationBookingDate).getTime() < new Date(latestBookingDate).getTime())
        ) {
          updates.consultationBookingDate = new Date(latestBookingDate);
        }
        if (
          latestCreatedAt &&
          (!directClient.consultationRecordCreatedAt ||
            new Date(directClient.consultationRecordCreatedAt).getTime() > new Date(latestCreatedAt).getTime())
        ) {
          updates.consultationRecordCreatedAt = new Date(latestCreatedAt);
        }
        if (Object.keys(updates).length > 0) {
          const updateResult = await prisma.directClient.updateMany({
            where: { id: directClient.id },
            data: updates,
          });
          if (updateResult.count > 0) {
            selfHealedConsultationDates = true;
            console.log('[direct-reconcile] ✅ Self-heal consultation dates', { altegioClientId });
          }
        }
      }
    } catch (err) {
      console.warn('[direct-reconcile] ⚠️ consultation dates self-heal:', err);
    }
  }

  return {
    selfHealedPaidAttendance,
    selfHealedPaidDates,
    selfHealedLastVisitAt,
    selfHealedConsultationAttendance,
    selfHealedConsultationDates,
  };
}

/** Завантажити групи з Altegio/KV і застосувати self-heal у Prisma. */
export async function reconcileDirectClientRecordsFromAltegio(
  altegioClientId: number
): Promise<SelfHealFromGroupsResult> {
  const { allGroups } = await loadAltegioRecordGroupsForClient(altegioClientId);
  return prismaSelfHealDirectClientFromRecordGroups(altegioClientId, allGroups);
}
