// web/app/api/admin/direct/sync-consultation-for-client/route.ts
// Повна синхронізація для ОДНОГО клієнта за Altegio ID:
// консультація (дата, attended), запис (дата, attended), сума (breakdown), state

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { getClientRecords, isConsultationService as isConsultationFromServices } from '@/lib/altegio/records';
import {
  normalizeRecordsLogItems,
  groupRecordsByClientDay,
  kyivDayFromISO,
  pickNonAdminStaffFromGroup,
  appendServiceMasterHistory,
  isAdminStaffName,
  computeGroupTotalCostUAH,
  getMainVisitIdFromGroup,
  getPerMasterSumsFromGroup,
  type RecordGroup,
} from '@/lib/altegio/records-grouping';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function toISO8601(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d/.test(s)
    ? s.replace(/(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : s;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function isConsultationService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /консультаці/i.test(title);
  });
}

function hasPaidService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    if (/консультаці/i.test(title)) return false;
    return true;
  });
}

/**
 * POST - повна синхронізація для одного клієнта: консультація, запис, сума, статуси
 * Body: { altegioClientId: number }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const altegioClientId = body.altegioClientId ?? req.nextUrl.searchParams.get('altegioClientId');
    const id = typeof altegioClientId === 'string' ? parseInt(altegioClientId, 10) : Number(altegioClientId);

    if (!Number.isFinite(id)) {
      return NextResponse.json(
        { ok: false, error: 'Потрібен altegioClientId (число)' },
        { status: 400 }
      );
    }

    const client = await prisma.directClient.findFirst({
      where: { altegioClientId: id },
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        altegioClientId: true,
        spent: true,
        consultationBookingDate: true,
        consultationAttended: true,
        consultationCancelled: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        paidServiceTotalCost: true,
        paidServiceVisitBreakdown: true,
        state: true,
        serviceMasterName: true,
        serviceMasterHistory: true,
      },
    });

    if (!client) {
      return NextResponse.json(
        { ok: false, error: `Клієнт з Altegio ID ${id} не знайдено в Direct` },
        { status: 404 }
      );
    }

    const result: {
      consultation: { bookingDateUpdated: boolean; bookingDateSource?: 'api' | 'kv'; bookingDate?: string; attendanceUpdated: boolean; attendance?: boolean; attendanceStatus?: 'arrived' | 'no-show' | 'cancelled' | 'confirmed' };
      paidService: { dateUpdated: boolean; date?: string; dateSource?: 'api' | 'kv'; attendanceUpdated: boolean; attendance?: boolean };
      breakdown: { updated: boolean; totalCost?: number };
      state: { updated: boolean; state?: string };
    } = {
      consultation: { bookingDateUpdated: false, attendanceUpdated: false },
      paidService: { dateUpdated: false, attendanceUpdated: false },
      breakdown: { updated: false },
      state: { updated: false },
    };

    // 1. Синхронізація consultationBookingDate
    let latestConsultationDate: string | null = null;
    let isOnlineConsultation: boolean | null = null;
    let source: 'api' | 'kv' = 'api';

    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    let apiRecords: Awaited<ReturnType<typeof getClientRecords>> = [];
    if (Number.isFinite(companyId) && companyId > 0) {
      apiRecords = await getClientRecords(companyId, id);
      const consultationRecords = apiRecords.filter(
        (r) => r.services?.length && isConsultationFromServices(r.services).isConsultation
      );
      if (consultationRecords.length > 0) {
        const best = consultationRecords.reduce((a, b) =>
          (b.date ? new Date(b.date).getTime() : 0) > (a.date ? new Date(a.date).getTime() : 0) ? b : a
        );
        if (best.date) {
          latestConsultationDate = best.date;
          isOnlineConsultation = isConsultationFromServices(best.services).isOnline;
        }
      }
    }

    if (!latestConsultationDate) {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      const groupsByClient = groupRecordsByClientDay(normalizedEvents);
      const groups = groupsByClient.get(id) || [];
      const consultationGroups = groups.filter((g) => g.groupType === 'consultation');
      if (consultationGroups.length > 0) {
        const latest = consultationGroups.sort((a, b) => {
          const ta = new Date(a.datetime || a.receivedAt || 0).getTime();
          const tb = new Date(b.datetime || b.receivedAt || 0).getTime();
          return tb - ta;
        })[0];
        const datetime = latest.datetime || latest.receivedAt;
        if (datetime) {
          latestConsultationDate = datetime;
          isOnlineConsultation = latest.services?.some((s: any) => /онлайн/i.test(s?.title || s?.name || '')) ?? false;
          source = 'kv';
        }
      }
    }

    if (latestConsultationDate) {
      const isoConsultationDate = toISO8601(latestConsultationDate);
      if (isoConsultationDate) {
        const shouldUpdate =
          !client.consultationBookingDate || new Date(client.consultationBookingDate) < new Date(isoConsultationDate);
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationBookingDate: isoConsultationDate,
              ...(isOnlineConsultation !== null && { isOnlineConsultation }),
            },
          });
          result.consultation.bookingDateUpdated = true;
          result.consultation.bookingDate = isoConsultationDate;
          result.consultation.bookingDateSource = source;
        }
      }
    }

    // 2. Синхронізація consultationAttended та consultationCancelled з groups (records+webhook)
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    const consultationGroups = (groupsByClient.get(id) || []).filter((g) => g.groupType === 'consultation');
    const latestConsultation = consultationGroups.sort((a, b) =>
      new Date(b.datetime || 0).getTime() - new Date(a.datetime || 0).getTime()
    )[0] || null;

    if (latestConsultation) {
      const attStatus = String((latestConsultation as any).attendanceStatus || '');
      const att = (latestConsultation as any).attendance;

      // Прийшов (1) / Клієнт підтвердив (2) / Клієнт не прийшов (-1) / Скасовано (-2)
      if (attStatus === 'cancelled' || att === -2) {
        const needsUpdate =
          (client as any).consultationCancelled !== true ||
          (client.consultationAttended !== null && client.consultationAttended !== undefined);
        if (needsUpdate && (client as any).consultationAttended !== true) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: { consultationCancelled: true, consultationAttended: null },
          });
          result.consultation.attendanceUpdated = true;
          result.consultation.attendanceStatus = 'cancelled';
        }
      } else if (attStatus === 'no-show' || att === -1) {
        const needsUpdate =
          client.consultationAttended !== false || (client as any).consultationCancelled !== false;
        if (needsUpdate && (client as any).consultationAttended !== true) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: { consultationAttended: false, consultationCancelled: false },
          });
          result.consultation.attendanceUpdated = true;
          result.consultation.attendanceStatus = 'no-show';
        }
      } else if (attStatus === 'arrived' || att === 1 || att === 2) {
        const newAttended = true;
        const attVal = att === 1 || att === 2 ? (att as 1 | 2) : 1;
        const needsUpdate =
          client.consultationAttended !== newAttended ||
          (client as any).consultationCancelled !== false ||
          (client as any).consultationAttendanceValue !== attVal;
        if (needsUpdate) {
          const updateData: any = {
            consultationAttended: newAttended,
            consultationCancelled: false,
            consultationAttendanceValue: attVal,
          };
          await prisma.directClient.update({
            where: { id: client.id },
            data: updateData,
          });
          result.consultation.attendanceUpdated = true;
          result.consultation.attendanceStatus = attVal === 2 ? 'confirmed' : 'arrived';
          result.consultation.attendance = newAttended;
        }
      }
    } else {
      // Fallback: raw records (включаючи attendance=-2, status=cancelled)
      const records = rawItemsRecords
        .map((raw) => {
          try {
            let parsed: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed?.value && typeof parsed.value === 'string') {
              try {
                parsed = JSON.parse(parsed.value);
              } catch {
                return null;
              }
            }
            return parsed;
          } catch {
            return null;
          }
        })
        .filter((r) => r && r.clientId && r.datetime && r.data?.services);

      const consultationRecords = records
        .filter((r) => {
          if (!isConsultationService(r.data?.services || [])) return false;
          const att = r.data?.attendance ?? r.data?.visit_attendance ?? r.attendance;
          const status = (r.data?.status ?? r.status ?? '').toString().toLowerCase();
          return att === 1 || att === 2 || att === -1 || att === -2 || status === 'cancelled';
        })
        .filter((r) => Number(r.clientId) === Number(id))
        .sort((a, b) =>
          new Date(b.datetime || b.data?.datetime || 0).getTime() - new Date(a.datetime || a.data?.datetime || 0).getTime()
        );

      if (consultationRecords.length > 0) {
        const latest = consultationRecords[0];
        const att = latest.data?.attendance ?? latest.data?.visit_attendance ?? latest.attendance;
        const status = (latest.data?.status ?? latest.status ?? '').toString().toLowerCase();

        if (att === -2 || status === 'cancelled') {
          if ((client as any).consultationCancelled !== true && (client as any).consultationAttended !== true) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: { consultationCancelled: true, consultationAttended: null },
            });
            result.consultation.attendanceUpdated = true;
            result.consultation.attendanceStatus = 'cancelled';
          }
        } else if (att === 1 || att === 2) {
          const attVal = att as 1 | 2;
          const updateData: any = {
            consultationAttended: true,
            consultationCancelled: false,
            consultationAttendanceValue: attVal,
          };
          const needsUpdate =
            client.consultationAttended !== true ||
            (client as any).consultationCancelled !== false ||
            (client as any).consultationAttendanceValue !== attVal;
          if (needsUpdate) {
            await prisma.directClient.update({ where: { id: client.id }, data: updateData });
            result.consultation.attendanceUpdated = true;
            result.consultation.attendanceStatus = attVal === 2 ? 'confirmed' : 'arrived';
            result.consultation.attendance = true;
          }
        } else if (att === -1) {
          const needsNoShowUpdate =
            (client.consultationAttended !== false || (client as any).consultationCancelled !== false) &&
            (client as any).consultationAttended !== true;
          if (needsNoShowUpdate) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: { consultationAttended: false, consultationCancelled: false },
            });
            result.consultation.attendanceUpdated = true;
            result.consultation.attendanceStatus = 'no-show';
          }
        }
      }
    }

    // Парсинг records з KV для paidServiceAttended fallback (section 4)
    const recordsFromKv = rawItemsRecords
      .map((raw) => {
        try {
          let parsed: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed?.value && typeof parsed.value === 'string') {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return null;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && r.datetime && r.data?.services);

    // 3. Синхронізація paidServiceDate — спочатку з Altegio API, fallback на KV
    let latestPaidServiceDate: string | null = null;
    let paidServiceSource: 'api' | 'kv' = 'api';
    const paidRecordsFromApi = apiRecords.filter(
      (r) => r.services?.length && !isConsultationFromServices(r.services).isConsultation
    );
    if (paidRecordsFromApi.length > 0) {
      const best = paidRecordsFromApi.reduce((a, b) =>
        (b.date ? new Date(b.date).getTime() : 0) > (a.date ? new Date(a.date).getTime() : 0) ? b : a
      );
      if (best.date) latestPaidServiceDate = best.date;
    }
    let groupsForState: RecordGroup[] = [];
    if (!latestPaidServiceDate) {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      const groupsByClient = groupRecordsByClientDay(normalizedEvents);
      groupsForState = groupsByClient.get(id) || [];
      const paidGroups = groupsForState.filter((g) => g.groupType === 'paid');
      if (paidGroups.length > 0) {
        const latest = paidGroups.sort((a, b) => {
          const ta = new Date(a.datetime || a.receivedAt || 0).getTime();
          const tb = new Date(b.datetime || b.receivedAt || 0).getTime();
          return tb - ta;
        })[0];
        const datetime = latest.datetime || latest.receivedAt;
        if (datetime) {
          latestPaidServiceDate = datetime;
          paidServiceSource = 'kv';
        }
      }
    }
    if (groupsForState.length === 0) {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      groupsForState = groupRecordsByClientDay(normalizedEvents).get(id) || [];
    }
    if (latestPaidServiceDate) {
      const isoPaidDate = toISO8601(latestPaidServiceDate);
      if (isoPaidDate) {
        const shouldUpdate =
          !client.paidServiceDate || new Date(client.paidServiceDate) < new Date(isoPaidDate);
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: { paidServiceDate: isoPaidDate, signedUpForPaidService: true },
          });
          result.paidService.dateUpdated = true;
          result.paidService.date = isoPaidDate;
          result.paidService.dateSource = paidServiceSource;
        }
      }
    }

    // 4. Синхронізація paidServiceAttended — спочатку з Altegio API, fallback на KV
    let newPaidAttended: boolean | null = null;
    const paidWithAttendanceFromApi = paidRecordsFromApi.filter(
      (r) => r.attendance === 1 || r.attendance === 2 || r.attendance === -1
    );
    if (paidWithAttendanceFromApi.length > 0) {
      const latest = paidWithAttendanceFromApi.reduce((a, b) =>
        (b.date ? new Date(b.date).getTime() : 0) > (a.date ? new Date(a.date).getTime() : 0) ? b : a
      );
      if (latest.attendance === 1 || latest.attendance === 2) newPaidAttended = true;
      else if (latest.attendance === -1) newPaidAttended = false;
    }
    let paidRecordsFromKv: { data?: { attendance?: number; visit_attendance?: number }; attendance?: number }[] = [];
    if (newPaidAttended === null) {
      paidRecordsFromKv = recordsFromKv
        .filter((r) => {
          const services = r.data?.services || r.services || [];
          if (!Array.isArray(services) || services.length === 0) return false;
          if (isConsultationService(services)) return false;
          if (!hasPaidService(services)) return false;
          const attendance = r.data?.attendance ?? r.data?.visit_attendance ?? r.attendance;
          return attendance === 1 || attendance === 2 || attendance === -1;
        })
        .filter((r) => Number(r.clientId) === Number(id))
        .sort((a, b) => {
          const ta = new Date(a.datetime || a.data?.datetime || 0).getTime();
          const tb = new Date(b.datetime || b.data?.datetime || 0).getTime();
          return tb - ta;
        });
      if (paidRecordsFromKv.length > 0) {
        const latest = paidRecordsFromKv[0];
        const attendance = latest.data?.attendance ?? latest.data?.visit_attendance ?? latest.attendance;
        if (attendance === 1 || attendance === 2) newPaidAttended = true;
        else if (attendance === -1) newPaidAttended = false;
      }
    }
    if (newPaidAttended !== null && client.paidServiceAttended !== newPaidAttended) {
      let paidAttVal: 1 | 2 | null = null;
      if (paidWithAttendanceFromApi.length > 0) {
        const latest = paidWithAttendanceFromApi.reduce((a, b) =>
          (b.date ? new Date(b.date).getTime() : 0) > (a.date ? new Date(a.date).getTime() : 0) ? b : a
        );
        if (latest.attendance === 1 || latest.attendance === 2) paidAttVal = latest.attendance as 1 | 2;
      } else if (paidRecordsFromKv.length > 0) {
        const att = paidRecordsFromKv[0].data?.attendance ?? paidRecordsFromKv[0].data?.visit_attendance ?? paidRecordsFromKv[0].attendance;
        if (att === 1 || att === 2) paidAttVal = att as 1 | 2;
      }
      const updateData: any = { paidServiceAttended: newPaidAttended };
      if (newPaidAttended && paidAttVal) updateData.paidServiceAttendanceValue = paidAttVal;
      await prisma.directClient.update({
        where: { id: client.id },
        data: updateData,
      });
      result.paidService.attendanceUpdated = true;
      result.paidService.attendance = newPaidAttended;
    }

    // 5. Синхронізація breakdown (сума запису) — потребує paidServiceDate
    const paidDateStr = result.paidService.date
      ? result.paidService.date
      : client.paidServiceDate
        ? (typeof client.paidServiceDate === 'string'
            ? client.paidServiceDate
            : (client.paidServiceDate as Date).toISOString?.() ?? String(client.paidServiceDate))
        : null;
    if (paidDateStr && Number.isFinite(companyId) && companyId > 0) {
      const paidKyivDay = kyivDayFromISO(paidDateStr);
      if (paidKyivDay) {
        let totalCost: number | null = null;
        let breakdown: { masterName: string; sumUAH: number }[] | null = null;
        let visitId: number | null = null;

        // API спочатку
        const recordsApi = apiRecords.length > 0 ? apiRecords : await getClientRecords(companyId, id);
        const dayRecords = recordsApi.filter((r) => r.date && kyivDayFromISO(r.date) === paidKyivDay);
        const paidRecord = dayRecords.find((r) => !isConsultationFromServices(r.services ?? []).isConsultation) ?? dayRecords[0];
        const apiVisitId = paidRecord?.visit_id ?? null;
        if (apiVisitId != null) {
          const apiBreakdown = await fetchVisitBreakdownFromAPI(apiVisitId, companyId);
          if (apiBreakdown && apiBreakdown.length > 0) {
            totalCost = apiBreakdown.reduce((a, b) => a + b.sumUAH, 0);
            breakdown = apiBreakdown;
            visitId = apiVisitId;
          }
        }

        // KV fallback: якщо API не дав даних
        if (totalCost == null && groupsForState.length > 0) {
          const paidGroups = groupsForState.filter((g) => g.groupType === 'paid');
          const paidGroup = paidGroups.find((g) => (g.kyivDay || '') === paidKyivDay) ?? paidGroups[0];
          if (paidGroup) {
            const kvTotal = computeGroupTotalCostUAH(paidGroup);
            if (kvTotal > 0) {
              totalCost = kvTotal;
              visitId = getMainVisitIdFromGroup(paidGroup);
              breakdown = getPerMasterSumsFromGroup(paidGroup, visitId ?? undefined);
            }
          }
        }

        if (totalCost != null && totalCost > 0) {
          const updateSpent = (client.spent ?? 0) === 0 && totalCost > 0;
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              paidServiceVisitId: visitId,
              paidServiceVisitBreakdown: breakdown && breakdown.length > 0 ? (breakdown as any) : undefined,
              paidServiceTotalCost: totalCost,
              ...(updateSpent ? { spent: totalCost } : {}),
            },
          });
          result.breakdown.updated = true;
          result.breakdown.totalCost = totalCost;
        }
      }
    }

    // 6. Синхронізація state (статус) з KV
    if (groupsForState.length > 0) {
      const latestPaid = groupsForState.find((g) => g.groupType === 'paid') || null;
      const latestConsultation = groupsForState.find((g) => g.groupType === 'consultation') || null;
      const chosen = latestPaid || latestConsultation;
      if (chosen) {
        const newState =
          chosen.groupType === 'consultation'
            ? 'consultation-booked'
            : (determineStateFromServices(chosen.services) || 'other-services');
        const picked = pickNonAdminStaffFromGroup(chosen, 'latest');
        const isValidMaster = picked?.staffName && !isAdminStaffName(picked.staffName);
        const finalPicked = isValidMaster ? picked : null;
        const needsMasterUpdate =
          !!finalPicked?.staffName && (client.serviceMasterName || '').trim() !== finalPicked.staffName.trim();
        if ((newState && client.state !== newState) || needsMasterUpdate) {
          const updateData: any = {};
          if (newState && client.state !== newState) {
            updateData.state = newState;
            result.state.updated = true;
            result.state.state = newState;
          }
          if (needsMasterUpdate && finalPicked) {
            const historyInput =
              typeof client.serviceMasterHistory === 'string'
                ? client.serviceMasterHistory
                : JSON.stringify(client.serviceMasterHistory || []);
            updateData.serviceMasterName = finalPicked.staffName;
            updateData.serviceMasterAltegioStaffId = finalPicked.staffId ?? null;
            updateData.serviceMasterHistory = appendServiceMasterHistory(historyInput, {
              kyivDay: chosen.kyivDay,
              masterName: finalPicked.staffName,
              source: 'records-group',
              recordedAt: new Date().toISOString(),
            });
          }
          if (Object.keys(updateData).length > 0) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: updateData,
            });
          }
        }
      }
    }

    // Повертаємо оновленого клієнта для локального оновлення UI без перезавантаження всієї бази
    const updatedClient = await getDirectClient(client.id);

    return NextResponse.json({
      ok: true,
      altegioClientId: id,
      clientName: [client.firstName, client.lastName].filter(Boolean).join(' ') || client.instagramUsername,
      result,
      ...(updatedClient ? { client: updatedClient } : {}),
    });
  } catch (error) {
    console.error('[sync-consultation-for-client] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
