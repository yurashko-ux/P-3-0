// web/app/api/admin/direct/sync-consultation-for-client/route.ts
// Синхронізація consultationBookingDate та consultationAttended для ОДНОГО клієнта за Altegio ID

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { kvRead } from '@/lib/kv';
import { getClientRecords, isConsultationService as isConsultationFromServices } from '@/lib/altegio/records';
import { normalizeRecordsLogItems, groupRecordsByClientDay } from '@/lib/altegio/records-grouping';

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

/**
 * POST - синхронізувати consultationBookingDate та consultationAttended для одного клієнта
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
        consultationBookingDate: true,
        consultationAttended: true,
      },
    });

    if (!client) {
      return NextResponse.json(
        { ok: false, error: `Клієнт з Altegio ID ${id} не знайдено в Direct` },
        { status: 404 }
      );
    }

    const result: {
      bookingDateUpdated: boolean;
      bookingDateSource?: 'api' | 'kv';
      bookingDate?: string;
      attendanceUpdated: boolean;
      attendance?: boolean;
    } = {
      bookingDateUpdated: false,
      attendanceUpdated: false,
    };

    // 1. Синхронізація consultationBookingDate
    let latestConsultationDate: string | null = null;
    let isOnlineConsultation: boolean | null = null;
    let source: 'api' | 'kv' = 'api';

    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    if (Number.isFinite(companyId) && companyId > 0) {
      const records = await getClientRecords(companyId, id);
      const consultationRecords = records.filter(
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
          result.bookingDateUpdated = true;
          result.bookingDate = isoConsultationDate;
          result.bookingDateSource = source;
        }
      }
    }

    // 2. Синхронізація consultationAttended
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    const records = rawItems
      .map((raw) => {
        try {
          let parsed: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
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
        const services = r.data?.services || [];
        if (!Array.isArray(services) || services.length === 0) return false;
        if (!isConsultationService(services)) return false;
        const attendance = r.data?.attendance ?? r.data?.visit_attendance ?? r.attendance;
        return attendance === 1 || attendance === 2 || attendance === -1;
      })
      .filter((r) => Number(r.clientId) === Number(id))
      .sort((a, b) => {
        const ta = new Date(a.datetime || a.data?.datetime || 0).getTime();
        const tb = new Date(b.datetime || b.data?.datetime || 0).getTime();
        return tb - ta;
      });

    if (consultationRecords.length > 0) {
      const latest = consultationRecords[0];
      const attendance = latest.data?.attendance ?? latest.data?.visit_attendance ?? latest.attendance;
      let newConsultationAttended: boolean | null = null;
      if (attendance === 1 || attendance === 2) newConsultationAttended = true;
      else if (attendance === -1) newConsultationAttended = false;

      if (newConsultationAttended !== null && client.consultationAttended !== newConsultationAttended) {
        await prisma.directClient.update({
          where: { id: client.id },
          data: { consultationAttended: newConsultationAttended },
        });
        result.attendanceUpdated = true;
        result.attendance = newConsultationAttended;
      }
    }

    return NextResponse.json({
      ok: true,
      altegioClientId: id,
      clientName: [client.firstName, client.lastName].filter(Boolean).join(' ') || client.instagramUsername,
      result,
    });
  } catch (error) {
    console.error('[sync-consultation-for-client] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
