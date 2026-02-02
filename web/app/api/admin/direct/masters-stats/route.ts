// web/app/api/admin/direct/masters-stats/route.ts
// Статистика по відповідальних (майстри/адміни/direct-менеджери) за календарний місяць (Europe/Kyiv).
// Джерела:
// - DB (DirectClient) для дат та поточного відповідального
// - KV (Altegio records/webhook logs) для визначення перезаписів (max 1/клієнт)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  computeServicesTotalCostUAH,
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  pickNonAdminStaffFromGroup,
  pickStaffFromGroup,
  getPerMasterCategorySumsFromGroup,
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

function getPrimaryStaffForAttendedGroup(group: any): { staffId: number | null; staffName: string } | null {
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

  if (!inDay[0]?.staffName) return null;
  return { staffId: inDay[0].staffId ?? null, staffName: String(inDay[0].staffName) };
}

function detectRebookForMonth(
  groups: any[],
  month: string
): { hasRebook: boolean; primaryStaff: { staffId: number | null; staffName: string } | null; nextRebookDate: string | null } {
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

    const primaryStaff = getPrimaryStaffForAttendedGroup(attendedGroup);
    const nextRebookDate = next?.datetime || null;

    return { hasRebook: true, primaryStaff, nextRebookDate };
  }

  return { hasRebook: false, primaryStaff: null, nextRebookDate: null };
}

function normalizeName(s: string | null | undefined): string {
  return (s || '').toString().trim().toLowerCase();
}

function firstTokenName(fullName: string | null | undefined): string {
  const n = normalizeName(fullName);
  if (!n) return '';
  return n.split(/\s+/)[0] || '';
}

function addMonths(monthKey: string, deltaMonths: number): string {
  // monthKey: YYYY-MM
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1 + deltaMonths, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
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
      select: { id: true, name: true, role: true, altegioStaffId: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const selectedMaster = masterIdFilter ? masters.find((m) => m.id === masterIdFilter) || null : null;
    const selectedMasterName = selectedMaster ? normalizeName(selectedMaster.name) : '';
    const selectedMasterFirst = selectedMaster ? firstTokenName(selectedMaster.name) : '';
    const selectedMasterStaffId = selectedMaster?.altegioStaffId ?? null;

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
        visits: true,
        consultationBookingDate: true,
        consultationAttended: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        serviceMasterName: true,
        serviceMasterAltegioStaffId: true,
        altegioClientId: true,
      },
    });

    // Мінімальна фільтрація вже зараз (бо в коді UI вона є), щоб панель не “жила окремо”.
    const filteredClients = clients.filter((c) => {
      if (statusId && c.statusId !== statusId) return false;
      if (selectedMaster) {
        // Спершу — точний матч по altegioStaffId (найнадійніше)
        if (selectedMasterStaffId && (c.serviceMasterAltegioStaffId ?? null) === selectedMasterStaffId) {
          // ok
        } else {
          // Фолбек — матч по першому слову (коли в DirectMaster тільки ім'я, а в Altegio ПІБ)
          const clientFirst = firstTokenName(c.serviceMasterName);
          if (selectedMasterFirst && clientFirst && clientFirst === selectedMasterFirst) {
            // ok
          } else if (selectedMasterName && normalizeName(c.serviceMasterName) === selectedMasterName) {
            // ok
          } else {
            return false;
          }
        }
      }
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

    // Індекс DirectMaster для атрибуції
    const masterIdByName = new Map<string, string>(); // full name або simple name
    const masterIdByFirst = new Map<string, string>(); // перше слово імені
    const masterIdByStaffId = new Map<number, string>();
    for (const m of masters) {
      const nm = normalizeName(m.name);
      if (nm) masterIdByName.set(nm, m.id);
      const first = firstTokenName(m.name);
      if (first) masterIdByFirst.set(first, m.id);
      if (typeof m.altegioStaffId === 'number') masterIdByStaffId.set(m.altegioStaffId, m.id);
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
      futureSum: number; // сума майбутніх записів (після сьогодні), грн
      monthToEndSum: number; // сума майбутніх записів до кінця поточного місяця, грн
      nextMonthSum: number; // сума записів на наступний місяць, грн
      plus2MonthSum: number; // сума записів через 2 місяці, грн
      servicesSum: number; // Послуги - сума, грн
      hairSum: number; // Волосся (Накладки, хвости, треси), грн
      goodsSum: number; // Товар - сума, грн
    };

    const rowsByMasterId = new Map<string, Row>();
    const ensureRow = (id: string, name: string, role: string) => {
      if (rowsByMasterId.has(id)) return rowsByMasterId.get(id)!;
      const row: Row = {
        masterId: id,
        masterName: name,
        role,
        clients: 0,
        consultBooked: 0,
        consultAttended: 0,
        paidAttended: 0,
        rebooksCreated: 0,
        rebookRatePct: 0,
        futureSum: 0,
        monthToEndSum: 0,
        nextMonthSum: 0,
        plus2MonthSum: 0,
        servicesSum: 0,
        hairSum: 0,
        goodsSum: 0,
      };
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

    const mapStaffToMasterId = (picked: { staffId: number | null; staffName: string } | null): string => {
      if (!picked) return unassignedId;
      if (picked.staffId != null && masterIdByStaffId.has(picked.staffId)) return masterIdByStaffId.get(picked.staffId)!;
      const full = normalizeName(picked.staffName);
      if (full && masterIdByName.has(full)) return masterIdByName.get(full)!;
      const first = firstTokenName(picked.staffName);
      if (first && masterIdByFirst.has(first)) return masterIdByFirst.get(first)!;
      return unassignedId;
    };

    const todayKyivDay = kyivDayFromISO(new Date().toISOString());
    const currentMonthKey = todayKyivDay ? todayKyivDay.slice(0, 7) : '';
    const nextMonthKey = currentMonthKey ? addMonths(currentMonthKey, 1) : '';
    const plus2MonthKey = currentMonthKey ? addMonths(currentMonthKey, 2) : '';

    const pickStaffForSums = (g: any): { staffId: number | null; staffName: string } | null => {
      // Для сум: беремо latest non-admin, а якщо його нема — fallback на admin (але без “невідомого”)
      const nonAdmin = pickNonAdminStaffFromGroup(g, 'latest');
      if (nonAdmin) return nonAdmin;
      return pickStaffFromGroup(g, { mode: 'latest', allowAdmin: true });
    };

    // Підрахунок по клієнтах/групах (по місяцю, Europe/Kyiv)
    for (const c of filteredClients) {
      // Altegio рахує консультацію як “візит”.
      // Правило: консультацію показуємо, якщо visits = 0 або visits = 1.
      // Ігноруємо консультацію тільки коли visits >= 2.
      const shouldIgnoreConsult = (c.visits ?? 0) >= 2;
      const groups = c.altegioClientId ? (groupsByClient.get(c.altegioClientId) || []) : [];
      const groupsInMonthAll = groups.filter((g: any) => (g?.kyivDay || '').slice(0, 7) === month);
      // Для “повторних” клієнтів консультації ігноруємо повністю
      const groupsInMonth = shouldIgnoreConsult
        ? groupsInMonthAll.filter((g: any) => g?.groupType !== 'consultation')
        : groupsInMonthAll;

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
        const picked = pickNonAdminStaffFromGroup(chosen, 'latest');
        clientMasterId = mapStaffToMasterId(picked);
      } else if (c.serviceMasterAltegioStaffId != null || c.serviceMasterName) {
        clientMasterId = mapStaffToMasterId({
          staffId: c.serviceMasterAltegioStaffId ?? null,
          staffName: c.serviceMasterName || '',
        });
      }

      const activeInMonth =
        (groupsInMonth && groupsInMonth.length > 0) ||
        (!shouldIgnoreConsult && !!c.consultationBookingDate && kyivMonthKeyFromISO(c.consultationBookingDate.toISOString()) === month) ||
        (!!c.paidServiceDate && kyivMonthKeyFromISO(c.paidServiceDate.toISOString()) === month);

      if (activeInMonth) {
        ensureClientSet(clientMasterId).add(c.id);
      }

      // consultBooked / consultAttended / paidAttended — атрибутуємо по групі
      if (groupsInMonth.length) {
        for (const g of groupsInMonth) {
          const picked = pickNonAdminStaffFromGroup(g, 'first');
          const mid = mapStaffToMasterId(picked);

          if (!shouldIgnoreConsult && g.groupType === 'consultation' && g.datetime) {
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
        const fallbackMid = mapStaffToMasterId({
          staffId: c.serviceMasterAltegioStaffId ?? null,
          staffName: c.serviceMasterName || '',
        });

        if (!shouldIgnoreConsult && !!c.consultationBookingDate && kyivMonthKeyFromISO(c.consultationBookingDate.toISOString()) === month) {
          ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').consultBooked += 1;
          if (c.consultationAttended === true) {
            ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').consultAttended += 1;
          }
        }
        if (!!c.paidServiceDate && kyivMonthKeyFromISO(c.paidServiceDate.toISOString()) === month && c.paidServiceAttended === true) {
          ensureRow(fallbackMid, rowsByMasterId.get(fallbackMid)?.masterName || 'Без майстра', rowsByMasterId.get(fallbackMid)?.role || 'unassigned').paidAttended += 1;
        }
      }

      // KPI суми: рахуємо по paid-групах відносно сьогодні (Europe/Kyiv), незалежно від фільтра month.
      if (todayKyivDay && currentMonthKey && groups.length) {
        const paidGroupsAll = groups.filter((g: any) => g?.groupType === 'paid' && (g?.kyivDay || ''));
        for (const g of paidGroupsAll) {
          const gDay: string = (g?.kyivDay || '').toString();
          if (!gDay) continue;
          const gMonth = gDay.slice(0, 7);

          const totalCost = computeServicesTotalCostUAH(g?.services || []);
          if (!totalCost || totalCost <= 0) continue;

          const staffForSum = pickStaffForSums(g);
          const mid = mapStaffToMasterId(staffForSum);
          const row = ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned');

          // future: строго після сьогодні (сьогодні = минуле)
          if (gDay > todayKyivDay) {
            row.futureSum += totalCost;
            if (gMonth === currentMonthKey) row.monthToEndSum += totalCost;
          }
          if (gMonth === nextMonthKey) row.nextMonthSum += totalCost;
          if (gMonth === plus2MonthKey) row.plus2MonthSum += totalCost;
        }
      }

      // Послуги / Волосся / Товар — по майстрах з paid-груп у вибраному місяці (attended)
      const paidGroupsInMonth = groups.filter(
        (g: any) => g?.groupType === 'paid' && (g?.kyivDay || '').slice(0, 7) === month && (g?.attendanceStatus === 'arrived' || g?.attendance === 1)
      );
      for (const g of paidGroupsInMonth) {
        const perMaster = getPerMasterCategorySumsFromGroup(g);
        for (const entry of perMaster) {
          const mid = mapStaffToMasterId({ staffId: null, staffName: entry.masterName });
          const row = ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned');
          row.servicesSum += entry.servicesSum;
          row.hairSum += entry.hairSum;
          row.goodsSum += entry.goodsSum;
        }
      }

      // Перезапис: max 1 per client, атрибутуємо по первинному майстру attended-групи (exclude admin/unknown)
      if (c.altegioClientId) {
        const rebook = detectRebookForMonth(groups, month);
        if (rebook.hasRebook) {
          const attributedMasterId = mapStaffToMasterId(rebook.primaryStaff || null);
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

