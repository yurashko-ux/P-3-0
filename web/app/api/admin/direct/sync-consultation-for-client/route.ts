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
import { fetchVisitBreakdownFromAPI, getMastersDisplayFromVisitDetails } from '@/lib/altegio/visits';
import { getClient as getAltegioClientProfile } from '@/lib/altegio/clients';
import { extractInstagramFromAltegioClient, isTechnicalDirectInstagramUsername } from '@/lib/altegio/client-utils';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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
        paidServiceRecordCreatedAt: true,
        paidServiceAttended: true,
        paidServiceCancelled: true,
        lastActivityKeys: true,
        paidServiceTotalCost: true,
        paidServiceVisitBreakdown: true,
        state: true,
        serviceMasterName: true,
        serviceMasterHistory: true,
        consultationMasterName: true,
      },
    });

    if (!client) {
      return NextResponse.json(
        { ok: false, error: `Клієнт з Altegio ID ${id} не знайдено в Direct` },
        { status: 404 }
      );
    }

    const result: {
      consultation: { bookingDateUpdated: boolean; bookingDateSource?: 'api' | 'kv'; bookingDate?: string; attendanceUpdated: boolean; attendance?: boolean; attendanceStatus?: 'arrived' | 'no-show' | 'cancelled' | 'confirmed'; attendanceSource?: 'api' | 'kv' };
      paidService: { dateUpdated: boolean; date?: string; dateSource?: 'api' | 'kv'; attendanceUpdated: boolean; attendance?: boolean; cancelledUpdated?: boolean };
      breakdown: { updated: boolean; totalCost?: number };
      state: { updated: boolean; state?: string };
      mastersFromVisitDetails: {
        consultationUpdated: boolean;
        serviceUpdated: boolean;
        consultationMasterName?: string | null;
        serviceMasterName?: string | null;
      };
      instagramFromAltegio: { updated: boolean; username?: string | null; note?: string };
    } = {
      consultation: { bookingDateUpdated: false, attendanceUpdated: false },
      paidService: { dateUpdated: false, attendanceUpdated: false },
      breakdown: { updated: false },
      state: { updated: false },
      mastersFromVisitDetails: { consultationUpdated: false, serviceUpdated: false },
      instagramFromAltegio: { updated: false, note: undefined },
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
          const now = new Date();
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationCancelled: true,
              consultationAttended: null,
              lastActivityAt: now,
              lastActivityKeys: ['consultationCancelled'],
            },
          });
          result.consultation.attendanceUpdated = true;
          result.consultation.attendanceStatus = 'cancelled';
        }
      } else if (attStatus === 'no-show' || att === -1) {
        const needsUpdate =
          client.consultationAttended !== false || (client as any).consultationCancelled !== false;
        if (needsUpdate && (client as any).consultationAttended !== true) {
          const now = new Date();
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationAttended: false,
              consultationCancelled: false,
              lastActivityAt: now,
              lastActivityKeys: ['consultationAttended'],
            },
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
          const now = new Date();
          const updateData: any = {
            consultationAttended: newAttended,
            consultationCancelled: false,
            consultationAttendanceValue: attVal,
            lastActivityAt: now,
            lastActivityKeys: ['consultationAttended'],
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
            const now = new Date();
            await prisma.directClient.update({
              where: { id: client.id },
              data: {
                consultationCancelled: true,
                consultationAttended: null,
                lastActivityAt: now,
                lastActivityKeys: ['consultationCancelled'],
              },
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
            const now = new Date();
            updateData.lastActivityAt = now;
            updateData.lastActivityKeys = ['consultationAttended'];
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
            const now = new Date();
            await prisma.directClient.update({
              where: { id: client.id },
              data: {
                consultationAttended: false,
                consultationCancelled: false,
                lastActivityAt: now,
                lastActivityKeys: ['consultationAttended'],
              },
            });
            result.consultation.attendanceUpdated = true;
            result.consultation.attendanceStatus = 'no-show';
          }
        }
      }
    }

    // 2.5. Fallback: consultationAttended з Altegio API (якщо KV не дав результат)
    if (!result.consultation.attendanceUpdated && apiRecords.length > 0) {
      const targetDate = latestConsultationDate || (client.consultationBookingDate ? String(client.consultationBookingDate) : null);
      if (targetDate) {
        const targetKyivDay = kyivDayFromISO(targetDate);
        const consultationRecordsFromApi = apiRecords.filter(
          (r) => r.services?.length && isConsultationFromServices(r.services).isConsultation
        );
        const matchingRecord = consultationRecordsFromApi
          .filter((r) => r.date && kyivDayFromISO(r.date) === targetKyivDay)
          .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())[0] ?? null;

        if (matchingRecord && (client as any).consultationAttended !== true) {
          const att = matchingRecord.attendance;
          const deleted = matchingRecord.deleted === true;

          if (deleted) {
            const needsUpdate = (client as any).consultationCancelled !== true;
            if (needsUpdate) {
              const now = new Date();
              await prisma.directClient.update({
                where: { id: client.id },
                data: {
                  consultationCancelled: true,
                  consultationAttended: null,
                  lastActivityAt: now,
                  lastActivityKeys: ['consultationCancelled'],
                },
              });
              result.consultation.attendanceUpdated = true;
              result.consultation.attendanceStatus = 'cancelled';
              result.consultation.attendanceSource = 'api';
            }
          } else if (att === 1 || att === 2) {
            const attVal = att as 1 | 2;
            const needsUpdate =
              client.consultationAttended !== true ||
              (client as any).consultationCancelled !== false ||
              (client as any).consultationAttendanceValue !== attVal;
            if (needsUpdate) {
              const now = new Date();
              await prisma.directClient.update({
                where: { id: client.id },
                data: {
                  consultationAttended: true,
                  consultationCancelled: false,
                  consultationAttendanceValue: attVal,
                  lastActivityAt: now,
                  lastActivityKeys: ['consultationAttended'],
                },
              });
              result.consultation.attendanceUpdated = true;
              result.consultation.attendanceStatus = attVal === 2 ? 'confirmed' : 'arrived';
              result.consultation.attendance = true;
              result.consultation.attendanceSource = 'api';
            }
          } else if (att === -1) {
            const needsNoShowUpdate =
              client.consultationAttended !== false || (client as any).consultationCancelled !== false;
            if (needsNoShowUpdate) {
              const now = new Date();
              await prisma.directClient.update({
                where: { id: client.id },
                data: {
                  consultationAttended: false,
                  consultationCancelled: false,
                  lastActivityAt: now,
                  lastActivityKeys: ['consultationAttended'],
                },
              });
              result.consultation.attendanceUpdated = true;
              result.consultation.attendanceStatus = 'no-show';
              result.consultation.attendanceSource = 'api';
            }
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
      const now = new Date();
      const updateData: any = {
        paidServiceAttended: newPaidAttended,
        lastActivityAt: now,
        lastActivityKeys: ['paidServiceAttended'],
      };
      if (newPaidAttended && paidAttVal) updateData.paidServiceAttendanceValue = paidAttVal;
      await prisma.directClient.update({
        where: { id: client.id },
        data: updateData,
      });
      result.paidService.attendanceUpdated = true;
      result.paidService.attendance = newPaidAttended;
    }

    // 4b. Код присутності 1/2 з API для **дати запису в таблиці** (не лише коли міняється paidServiceAttended).
    // Інакше в БД лишається attended=true без paidServiceAttendanceValue, а таблиця дає евристику «прийшов» (1)
    // замість «підтвердив запис» (2), хоча в історії та Altegio — 2.
    const rowPaid = await prisma.directClient.findUnique({
      where: { id: client.id },
      select: {
        paidServiceDate: true,
        paidServiceAttended: true,
        paidServiceAttendanceValue: true,
        paidServiceCancelled: true,
      },
    });
    if (
      rowPaid &&
      !rowPaid.paidServiceCancelled &&
      rowPaid.paidServiceDate &&
      apiRecords.length > 0
    ) {
      const paidIso =
        typeof rowPaid.paidServiceDate === 'string'
          ? rowPaid.paidServiceDate
          : rowPaid.paidServiceDate instanceof Date
            ? rowPaid.paidServiceDate.toISOString()
            : String(rowPaid.paidServiceDate);
      const paidKyivTarget = kyivDayFromISO(paidIso);
      if (paidKyivTarget) {
        const sameDayPaid = apiRecords.filter((r) => {
          if (!r.date || !r.services?.length) return false;
          if (isConsultationFromServices(r.services).isConsultation) return false;
          return kyivDayFromISO(r.date) === paidKyivTarget;
        });
        const withAtt = sameDayPaid.filter(
          (r) => r.attendance === 1 || r.attendance === 2 || r.attendance === -1
        );
        if (withAtt.length > 0) {
          const best = withAtt.reduce((a, b) =>
            new Date(b.date!).getTime() > new Date(a.date!).getTime() ? b : a
          );
          const attNum = best.attendance;
          const dbVal = rowPaid.paidServiceAttendanceValue;
          if ((attNum === 1 || attNum === 2) && dbVal !== attNum) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: {
                paidServiceAttendanceValue: attNum as 1 | 2,
                ...(rowPaid.paidServiceAttended !== true ? { paidServiceAttended: true } : {}),
              },
            });
            console.log(
              `[sync-consultation-for-client] 4b: paidServiceAttendanceValue ${dbVal ?? 'null'} → ${attNum} (Kyiv day ${paidKyivTarget})`
            );
          }
        }
      }
    }

    // 4.5. Синхронізація paidServiceCancelled (🚫) з groupsForState — для крапочки в таблиці
    const paidDateStrForGroup = result.paidService.date
      ? result.paidService.date
      : client.paidServiceDate
        ? (typeof client.paidServiceDate === 'string'
            ? client.paidServiceDate
            : (client.paidServiceDate as Date).toISOString?.() ?? String(client.paidServiceDate))
        : latestPaidServiceDate;
    if (paidDateStrForGroup && groupsForState.length > 0) {
      const paidKyivDayForGroup = kyivDayFromISO(paidDateStrForGroup);
      const paidGroup = groupsForState
        .filter((g) => g.groupType === 'paid')
        .find((g) => (g.kyivDay || '') === paidKyivDayForGroup) ?? groupsForState.find((g) => g.groupType === 'paid');
      if (paidGroup) {
        const attStatus = String((paidGroup as any).attendanceStatus || '');
        const attVal = (paidGroup as any).attendance ?? null;
        const isCancelled = attStatus === 'cancelled' || attVal === -2;
        const dbCancelled = Boolean((client as any).paidServiceCancelled ?? false);
        if (isCancelled !== dbCancelled) {
          const now = new Date();
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              paidServiceCancelled: isCancelled,
              ...(isCancelled ? { paidServiceAttended: null } : {}),
              lastActivityAt: now,
              lastActivityKeys: ['paidServiceCancelled'],
            },
          });
          result.paidService.cancelledUpdated = true;
        }
      }
    }

    // 4.5a. Відновлення крапочки для consultationAttended/consultationCancelled
    // Якщо консультація сьогодні, є статус attendance, але lastActivityKeys не містить ключа — виставляємо
    let lastActivityKeysRepaired = false;
    const todayKyiv = kyivDayFromISO(new Date().toISOString());
    const consultBookingKyivDay = client.consultationBookingDate
      ? kyivDayFromISO(typeof client.consultationBookingDate === 'string'
          ? client.consultationBookingDate
          : (client.consultationBookingDate as Date)?.toISOString?.() ?? '')
      : null;
    const hasConsultKey =
      Array.isArray(client.lastActivityKeys) &&
      (client.lastActivityKeys.includes('consultationAttended') || client.lastActivityKeys.includes('consultationCancelled'));
    const hasConsultAttendance =
      client.consultationAttended === true ||
      client.consultationAttended === false ||
      (client as any).consultationCancelled === true;
    if (
      consultBookingKyivDay &&
      consultBookingKyivDay === todayKyiv &&
      !hasConsultKey &&
      hasConsultAttendance
    ) {
      const now = new Date();
      const repairKey = (client as any).consultationCancelled === true ? 'consultationCancelled' : 'consultationAttended';
      await prisma.directClient.update({
        where: { id: client.id },
        data: { lastActivityAt: now, lastActivityKeys: [repairKey] },
      });
      lastActivityKeysRepaired = true;
    }

    // 4.6. Відновлення крапочки для paidServiceRecordCreatedAt
    // Якщо запис створений сьогодні, але lastActivityKeys не містить ключа — виставляємо
    const paidCreatedAt = client.paidServiceRecordCreatedAt;
    const paidCreatedKyivDay = paidCreatedAt
      ? kyivDayFromISO(typeof paidCreatedAt === 'string' ? paidCreatedAt : (paidCreatedAt as Date).toISOString?.() ?? '')
      : null;
    const hasKey =
      Array.isArray(client.lastActivityKeys) && client.lastActivityKeys.includes('paidServiceRecordCreatedAt');
    if (paidCreatedKyivDay && paidCreatedKyivDay === todayKyiv && !hasKey) {
      const now = new Date();
      await prisma.directClient.update({
        where: { id: client.id },
        data: { lastActivityAt: now, lastActivityKeys: ['paidServiceRecordCreatedAt'] },
      });
      lastActivityKeysRepaired = true;
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

    // 7. consultationMasterName / serviceMasterName з Visit Details API (аналог кнопки «Backfill майстри») —
    //    щоб у таблиці був формат Altegio «Головний (Інші)», а не лише masterId з ліда.
    if (Number.isFinite(companyId) && companyId > 0 && apiRecords.length > 0) {
      const sortedApi = [...apiRecords]
        .filter((r) => !r.deleted && r.date)
        .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());

      const consultationRecords = sortedApi.filter((rec) => isConsultationService(rec.services ?? []));
      const paidOrAnyRecords = sortedApi.filter(
        (rec) => hasPaidService(rec.services ?? []) || isConsultationService(rec.services ?? [])
      );
      const latestConsultationRec = consultationRecords[0];
      const latestForServiceRec = paidOrAnyRecords[0];

      const updatesMaster: { consultationMasterName?: string; serviceMasterName?: string } = {};

      if (latestConsultationRec) {
        const recordId = Number(
          latestConsultationRec.record_id ??
            (latestConsultationRec as { recordId?: number }).recordId ??
            (latestConsultationRec as { id?: number }).id
        );
        const visitId = Number(latestConsultationRec.visit_id);
        const staffName = (latestConsultationRec.staff_name ??
          (latestConsultationRec as { staff?: { name?: string } }).staff?.name ??
          null) as string | null;
        if (Number.isFinite(recordId) && recordId > 0 && Number.isFinite(visitId) && visitId > 0) {
          try {
            const display = await getMastersDisplayFromVisitDetails(
              companyId,
              recordId,
              visitId,
              staffName
            );
            const newConsult = (display ?? staffName ?? '').trim() || null;
            const prevConsult = ((client as { consultationMasterName?: string | null }).consultationMasterName || '')
              .trim() || null;
            if (newConsult && newConsult !== prevConsult) {
              updatesMaster.consultationMasterName = newConsult;
              result.mastersFromVisitDetails.consultationMasterName = newConsult;
            }
          } catch (e) {
            console.warn('[sync-consultation-for-client] consultation Visit Details:', e);
          }
        }
      }

      if (latestForServiceRec) {
        const recordId = Number(
          latestForServiceRec.record_id ??
            (latestForServiceRec as { recordId?: number }).recordId ??
            (latestForServiceRec as { id?: number }).id
        );
        const visitId = Number(latestForServiceRec.visit_id);
        const staffName = (latestForServiceRec.staff_name ??
          (latestForServiceRec as { staff?: { name?: string } }).staff?.name ??
          null) as string | null;
        if (Number.isFinite(recordId) && recordId > 0 && Number.isFinite(visitId) && visitId > 0) {
          try {
            const display = await getMastersDisplayFromVisitDetails(
              companyId,
              recordId,
              visitId,
              staffName
            );
            const newSvc = (display ?? staffName ?? '').trim() || null;
            const prevSvc = (client.serviceMasterName || '').trim() || null;
            if (newSvc && newSvc !== prevSvc) {
              updatesMaster.serviceMasterName = newSvc;
              result.mastersFromVisitDetails.serviceMasterName = newSvc;
            }
          } catch (e) {
            console.warn('[sync-consultation-for-client] service Visit Details:', e);
          }
        }
      }

      if (Object.keys(updatesMaster).length > 0) {
        await prisma.directClient.update({
          where: { id: client.id },
          data: updatesMaster,
        });
        result.mastersFromVisitDetails.consultationUpdated = Boolean(updatesMaster.consultationMasterName);
        result.mastersFromVisitDetails.serviceUpdated = Boolean(updatesMaster.serviceMasterName);
      }
    }

    // 8. Instagram з профілю Altegio — якщо в Direct технічний username, а в картці CRM уже є Instagram
    if (Number.isFinite(companyId) && companyId > 0 && isTechnicalDirectInstagramUsername(client.instagramUsername)) {
      try {
        const profile = await getAltegioClientProfile(companyId, id);
        const ig = profile ? extractInstagramFromAltegioClient(profile) : null;
        if (ig) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: { instagramUsername: ig },
          });
          result.instagramFromAltegio = {
            updated: true,
            username: ig,
            note: 'з профілю Altegio (custom_fields / поля Instagram)',
          };
        } else {
          result.instagramFromAltegio = {
            updated: false,
            note:
              'У профілі Altegio не знайдено реального Instagram — злиття (#28) не допоможе без другого рядка. Вкажіть нік вручну або спробуйте кнопку «Відновити Instagram з повідомлень» (#11), якщо діалог у Direct уже був.',
          };
        }
      } catch (e) {
        console.warn('[sync-consultation-for-client] instagram from Altegio profile:', e);
        result.instagramFromAltegio = {
          updated: false,
          note: `помилка запиту профілю Altegio: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // Повертаємо оновленого клієнта для локального оновлення UI без перезавантаження всієї бази
    const updatedClient = await getDirectClient(client.id);

    return NextResponse.json({
      ok: true,
      altegioClientId: id,
      clientName: [client.firstName, client.lastName].filter(Boolean).join(' ') || client.instagramUsername,
      result: { ...result, lastActivityKeysRepair: lastActivityKeysRepaired },
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
