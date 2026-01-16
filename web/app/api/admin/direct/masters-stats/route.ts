// web/app/api/admin/direct/masters-stats/route.ts
// Статистика по відповідальних (майстри/адміни/direct-менеджери) за календарний місяць (Europe/Kyiv).
// Джерела:
// - DB (DirectClient) для дат та поточного відповідального
// - KV (Altegio records/webhook logs) для визначення перезаписів (max 1/клієнт)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  pickStaffFromGroup,
} from '@/lib/altegio/records-grouping';

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

function kyivMonthKeyFromISO(iso: string): string {
  // kyivDayFromISO повертає YYYY-MM-DD
  const day = kyivDayFromISO(iso);
  return day ? day.slice(0, 7) : '';
}

function isValidMonth(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}$/.test(value);
}

function getCreateReceivedAtKyivDay(group: any): string | null {
  const events = Array.isArray(group?.events) ? group.events : [];
  const createEvents = events.filter((e: any) => (e?.status || '').toString().toLowerCase() === 'create' && e?.receivedAt);
  if (createEvents.length === 0) return null;
  createEvents.sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  const first = createEvents[0];
  const receivedAt = first?.receivedAt;
  if (!receivedAt) return null;
  const day = kyivDayFromISO(receivedAt);
  return day || null;
}

function getAttendedEventReceivedAt(group: any): string | null {
  const events = Array.isArray(group?.events) ? group.events : [];
  const kyivDay = group?.kyivDay || '';
  const attended = events
    .filter((e: any) => e?.attendance === 1 && e?.receivedAt && kyivDayFromISO(e.receivedAt) === kyivDay)
    .sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  return attended[0]?.receivedAt || null;
}

function getPrimaryStaffForAttendedGroup(group: any): string | null {
  // Майстер для атрибуції “Перезапис”: перший (за receivedAt) не-адмін/не-невідомий staff у цій attended-групі в цей день
  const kyivDay = group?.kyivDay || '';
  if (!kyivDay) return null;

  const events = Array.isArray(group?.events) ? group.events : [];
  const inDay = events
    .filter((e: any) => {
      if (!e?.receivedAt) return false;
      if (kyivDayFromISO(e.receivedAt) !== kyivDay) return false;
      const name = (e?.staffName || '').toString().trim();
      if (!name) return false;
      if (name.toLowerCase().includes('невідом')) return false;
      if (isAdminStaffName(name)) return false;
      return true;
    })
    .sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

  return inDay[0]?.staffName ? String(inDay[0].staffName) : null;
}

function detectRebookForMonth(groups: any[], month: string): { hasRebook: boolean; primaryStaffName: string | null; nextRebookDate: string | null } {
  // max 1 перезапис на клієнта в межах місяця
  const paidGroups = groups.filter((g) => g?.groupType === 'paid');
  for (const attendedGroup of paidGroups) {
    if (attendedGroup?.attendanceStatus !== 'arrived' && attendedGroup?.attendance !== 1) continue;
    const attendedDay = attendedGroup?.kyivDay || '';
    if (!attendedDay) continue;
    if (attendedDay.slice(0, 7) !== month) continue;

    // attended webhook має прийти в день візиту
    const attendedReceivedAt = getAttendedEventReceivedAt(attendedGroup);
    if (!attendedReceivedAt) {
      // є ✅, але не в день візиту → не атрибутуємо й не рахуємо як перезапис для KPI
      continue;
    }

    // Шукаємо майбутні paid групи, створені в той же день (receivedAt create == attendedDay)
    const candidates = paidGroups
      .filter((g) => g !== attendedGroup)
      .filter((g) => (g?.kyivDay || '') > attendedDay)
      .map((g) => ({ g, createdDay: getCreateReceivedAtKyivDay(g) }))
      .filter(({ createdDay }) => createdDay === attendedDay);

    if (candidates.length === 0) continue;

    // Вибираємо найближчий майбутній запис (по kyivDay/ datetime)
    candidates.sort((a, b) => {
      const da = a.g?.datetime ? new Date(a.g.datetime).getTime() : 0;
      const db = b.g?.datetime ? new Date(b.g.datetime).getTime() : 0;
      if (da && db) return da - db;
      return (a.g?.kyivDay || '').localeCompare(b.g?.kyivDay || '');
    });
    const next = candidates[0]?.g || null;

    const primaryStaffName = getPrimaryStaffForAttendedGroup(attendedGroup);
    const nextRebookDate = next?.datetime || null;

    return { hasRebook: true, primaryStaffName, nextRebookDate };
  }

  return { hasRebook: false, primaryStaffName: null, nextRebookDate: null };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const month = req.nextUrl.searchParams.get('month');
    if (!isValidMonth(month)) {
      return NextResponse.json({ ok: false, error: 'month must be YYYY-MM' }, { status: 400 });
    }

    // Майбутні фільтри: приймаємо, але поки не ускладнюємо вибірку (узгоджено).
    // Коли реалізуємо фільтри в UI — тут підключимо ті ж правила.
    const statusId = req.nextUrl.searchParams.get('statusId') || '';
    const masterIdFilter = req.nextUrl.searchParams.get('masterId') || '';
    const source = req.nextUrl.searchParams.get('source') || '';
    const search = req.nextUrl.searchParams.get('search') || '';
    const hasAppointment = req.nextUrl.searchParams.get('hasAppointment') || '';

    console.log('[direct/masters-stats] 🔍 Calculating stats', { month, statusId, masterIdFilter, source, search, hasAppointment });

    // Всі відповідальні (включно admin/direct-manager/master)
    const masters = await prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const selectedMasterName = masterIdFilter
      ? (masters.find((m) => m.id === masterIdFilter)?.name || '').trim().toLowerCase()
      : '';

    // Беремо клієнтів з бази.
    // Важливо: ми використовуємо ці ж поля, що й таблиця.
    const clients = await prisma.directClient.findMany({
      select: {
        id: true,
        statusId: true,
        source: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        consultationBookingDate: true,
        consultationAttended: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        serviceMasterName: true,
        altegioClientId: true,
      },
    });

    // Мінімальна фільтрація вже зараз (бо в коді UI вона є), щоб панель не “жила окремо”.
    const filteredClients = clients.filter((c) => {
      if (statusId && c.statusId !== statusId) return false;
      if (selectedMasterName && (c.serviceMasterName || '').trim().toLowerCase() !== selectedMasterName) return false;
      if (source && (c.source || '') !== source) return false;
      if (hasAppointment === 'true' && !(c.paidServiceDate || c.consultationBookingDate)) return false;
      if (search) {
        const hay = [
          c.instagramUsername,
          c.firstName || '',
          c.lastName || '',
          c.altegioClientId ? String(c.altegioClientId) : '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });

    // Завантажуємо KV один раз і групуємо по клієнту
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    // Індекс майстрів по імені (для атрибуції перезаписів)
    const masterIdByName = new Map<string, string>();
    for (const m of masters) {
      masterIdByName.set(m.name.trim().toLowerCase(), m.id);
    }

    type Row = {
      masterId: string;
      masterName: string;
      role: string;
      clients: number;
      consultBooked: number;
      consultAttended: number;
      paidAttended: number;
      rebooksCreated: number; // max 1 per client
      rebookRatePct: number; // % перезаписів від attended paid
    };

    const rowsByMasterId = new Map<string, Row>();
    const ensureRow = (id: string, name: string, role: string) => {
      if (rowsByMasterId.has(id)) return rowsByMasterId.get(id)!;
      const row: Row = { masterId: id, masterName: name, role, clients: 0, consultBooked: 0, consultAttended: 0, paidAttended: 0, rebooksCreated: 0, rebookRatePct: 0 };
      rowsByMasterId.set(id, row);
      return row;
    };

    // Додаємо всіх відповідальних (навіть з нулями)
    for (const m of masters) ensureRow(m.id, m.name, m.role);
    const unassignedId = 'unassigned';
    ensureRow(unassignedId, 'Без майстра', 'unassigned');

    const clientsSetByMasterId = new Map<string, Set<string>>();
    const ensureClientSet = (id: string) => {
      if (clientsSetByMasterId.has(id)) return clientsSetByMasterId.get(id)!;
      const s = new Set<string>();
      clientsSetByMasterId.set(id, s);
      return s;
    };

    const pickNameForStats = (group: any): string | null => {
      const picked = pickStaffFromGroup(group, { mode: 'first', allowAdmin: true });
      return picked?.staffName ? String(picked.staffName) : null;
    };

    // Підрахунок по клієнтах/групах (по місяцю, Europe/Kyiv)
    for (const c of filteredClients) {
      const groups = c.altegioClientId ? (groupsByClient.get(c.altegioClientId) || []) : [];
      const groupsInMonth = groups.filter((g: any) => (g?.kyivDay || '').slice(0, 7) === month);

      // Визначаємо "клієнта у майстра" за найновішою групою в місяці
      let clientMasterId = unassignedId;
      if (groupsInMonth.length) {
        const sorted = [...groupsInMonth].sort((a: any, b: any) => {
          const da = (a?.kyivDay || '').localeCompare(b?.kyivDay || '');
          if (da !== 0) return -da; // desc
          const ta = new Date(a?.receivedAt || a?.datetime || 0).getTime();
          const tb = new Date(b?.receivedAt || b?.datetime || 0).getTime();
          return tb - ta;
        });
        const chosen = sorted[0];
        const name = pickNameForStats(chosen);
        if (name) {
          const key = name.trim().toLowerCase();
          clientMasterId = masterIdByName.get(key) || unassignedId;
        }
      } else if (c.serviceMasterName) {
        const key = c.serviceMasterName.trim().toLowerCase();
        clientMasterId = masterIdByName.get(key) || unassignedId;
      }

      const activeInMonth =
        (groupsInMonth && groupsInMonth.length > 0) ||
        (!!c.consultationBookingDate && kyivMonthKeyFromISO(c.consultationBookingDate.toISOString()) === month) ||
        (!!c.paidServiceDate && kyivMonthKeyFromISO(c.paidServiceDate.toISOString()) === month);

      if (activeInMonth) {
        ensureClientSet(clientMasterId).add(c.id);
      }

      // consultBooked / consultAttended / paidAttended — атрибутуємо по групі
      if (groupsInMonth.length) {
        for (const g of groupsInMonth) {
          const name = pickNameForStats(g);
          const mid = name ? masterIdByName.get(name.trim().toLowerCase()) || unassignedId : unassignedId;

          if (g.groupType === 'consultation' && g.datetime) {
            ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned').consultBooked += 1;
            if (g.attendanceStatus === 'arrived' || g.attendance === 1) {
              ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned').consultAttended += 1;
            }
          }
          if (g.groupType === 'paid' && (g.attendanceStatus === 'arrived' || g.attendance === 1)) {
            ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned').paidAttended += 1;
          }
        }
      } else {
        // Фолбек для клієнтів без Altegio груп у KV: атрибутуємо по serviceMasterName (якщо є)
        const fallbackMid =
          c.serviceMasterName && masterIdByName.has(c.serviceMasterName.trim().toLowerCase())
            ? masterIdByName.get(c.serviceMasterName.trim().toLowerCase())!
            : unassignedId;

        if (!!c.consultationBookingDate && kyivMonthKeyFromISO(c.consultationBookingDate.toISOString()) === month) {
          ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').consultBooked += 1;
          if (c.consultationAttended === true) {
            ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').consultAttended += 1;
          }
        }
        if (!!c.paidServiceDate && kyivMonthKeyFromISO(c.paidServiceDate.toISOString()) === month && c.paidServiceAttended === true) {
          ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').paidAttended += 1;
        }
      }

      // Перезапис: max 1 per client, атрибутуємо по первинному майстру attended-групи (exclude admin/unknown)
      if (c.altegioClientId) {
        const rebook = detectRebookForMonth(groups, month);
        if (rebook.hasRebook) {
          const keyName = (rebook.primaryStaffName || '').trim().toLowerCase();
          const attributedMasterId = keyName && masterIdByName.has(keyName) ? masterIdByName.get(keyName)! : unassignedId;
          ensureRow(
            attributedMasterId,
            rowsByMasterId.get(attributedMasterId)?.masterName || 'Без майстра',
            rowsByMasterId.get(attributedMasterId)?.role || 'unassigned'
          ).rebooksCreated += 1;
        }
      }
    }

    // Записуємо кількість клієнтів (унікальних) по майстру
    for (const [mid, set] of clientsSetByMasterId.entries()) {
      ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned').clients = set.size;
    }

    // % перезаписів
    for (const row of rowsByMasterId.values()) {
      row.rebookRatePct = row.paidAttended > 0 ? Math.round((row.rebooksCreated / row.paidAttended) * 1000) / 10 : 0;
    }

    const mastersRows = masters.map((m) => rowsByMasterId.get(m.id)!).filter(Boolean);
    const unassignedRow = rowsByMasterId.get(unassignedId)!;

    return NextResponse.json({
      ok: true,
      month,
      totalClients: filteredClients.length,
      masters: mastersRows,
      unassigned: unassignedRow,
      debug: {
        mastersCount: masters.length,
        filteredClientsCount: filteredClients.length,
        normalizedEventsCount: normalizedEvents.length,
        groupsByClientCount: groupsByClient.size,
      },
    });
  } catch (error) {
    console.error('[direct/masters-stats] ❌ Error:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

