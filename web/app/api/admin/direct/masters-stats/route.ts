// web/app/api/admin/direct/masters-stats/route.ts
// Статистика по відповідальних (майстри/адміни/direct-менеджери) за календарний місяць (Europe/Kyiv).
// Джерела:
// - DB (DirectClient) для дат та поточного відповідального
// - KV (Altegio records/webhook logs) для визначення перезаписів (max 1/клієнт)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import {
  computeGroupTotalCostUAH,
  computeServicesTotalCostUAH,
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  pickNonAdminStaffFromGroup,
  pickStaffFromGroup,
  getPerMasterCategorySumsFromGroup,
} from '@/lib/altegio/records-grouping';
import { fetchRecordsMtdTurnoverByStaffId } from '@/lib/altegio/records';
import {
  fetchStaffCalculationIncomeUAH,
  fetchStaffDailyPeriodTurnoverUAH,
  resolveAltegioLocationIdNumeric,
} from '@/lib/altegio/staff-period-income';
import { fetchMasterRevenueFromIncomeDailyChart } from '@/lib/altegio/analytics';
import { fetchZReportMtdTurnoverByMasterId } from '@/lib/altegio/z-report-turnover';

/** Успішна відповідь fetchRecordsMtdTurnoverByStaffId (для типу applyFullRecordsMtd). */
type RecordsMtdOkResult = Extract<Awaited<ReturnType<typeof fetchRecordsMtdTurnoverByStaffId>>, { ok: true }>;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** GET /records з пагінацією + fallback-ланцюжок — при великій базі записів потрібен запас часу. */
export const maxDuration = 120;

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
    .filter((e: any) => (e?.attendance === 1 || e?.attendance === 2) && e?.receivedAt && kyivDayFromISO(e.receivedAt) === kyivDay)
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
    if (attendedGroup?.attendanceStatus !== 'arrived' && attendedGroup?.attendance !== 1 && attendedGroup?.attendance !== 2) continue;
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

function normalizeExcelMatchKey(name: string | null | undefined): string {
  return firstTokenName(name).replace(/['ʼ`]/g, '');
}

function getPaidSumBreakdown(client: {
  paidServiceVisitBreakdown?: unknown;
  paidServiceTotalCost?: number | null;
}): Array<{ masterName: string; sumUAH: number }> {
  const breakdown = Array.isArray(client?.paidServiceVisitBreakdown)
    ? (client.paidServiceVisitBreakdown as Array<{ masterName?: string; sumUAH?: number }>)
    : [];

  const validBreakdown = breakdown
    .map((entry) => ({
      masterName: String(entry?.masterName || '').trim(),
      sumUAH: Number(entry?.sumUAH) || 0,
    }))
    .filter((entry) => entry.sumUAH > 0);

  if (validBreakdown.length > 0) return validBreakdown;

  const totalCost = Number(client?.paidServiceTotalCost) || 0;
  if (totalCost <= 0) return [];

  return [{ masterName: '', sumUAH: totalCost }];
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

function getMonthBounds(monthKey: string): { start: string; end: string } {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  };
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

    /** Діагностика джерела МТД (Network → відповідь JSON → debug.mtd). */
    let mtdApiDebug:
      | {
          strategy: string;
          incomeOkCount: number;
          incomeSamePositiveTotal: boolean;
          mastersWithStaff: number;
          /** true — колонка МТД без накопичення з Direct paidService. */
          altegioOnlyMtd: boolean;
        }
      | undefined;

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
        paidServiceRecordCreatedAt: true,
        paidServiceAttended: true,
        paidServiceTotalCost: true,
        paidServiceVisitBreakdown: true,
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
      /** Майбутні (gDay > сьогодні) у поточному місяці: букінг 1–15 число (допоміжне; колонка C тепер — оборот MTD) */
      futureMonthFromStartUAH: number;
      /** Майбутні у поточному місяці: букінг 16 — останній день — колонка D */
      futureMonthToEndUAH: number;
      /** Оборот МТД: GET /records → income_daily → Z-звіт → payroll → Direct */
      turnoverMonthToDateUAH: number;
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
        futureMonthFromStartUAH: 0,
        futureMonthToEndUAH: 0,
        turnoverMonthToDateUAH: 0,
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
    const todayMonthKey = todayKyivDay ? todayKyivDay.slice(0, 7) : '';
    const selectedMonthBounds = getMonthBounds(month);
    const selectedMonthEndDay = month ? selectedMonthBounds.end : '';
    const monthToDateCutoffDay =
      month === todayMonthKey
        ? todayKyivDay
        : month < todayMonthKey
          ? selectedMonthEndDay
          : '';
    const nextMonthKey = month ? addMonths(month, 1) : '';
    const plus2MonthKey = month ? addMonths(month, 2) : '';
    /** Якщо буде Altegio-МТД — не додавати в колонку суми з Direct paidService (інакше «без змін» при тих самих цифрах). */
    const mtdAltegioLocationId = monthToDateCutoffDay ? resolveAltegioLocationIdNumeric() : null;
    const skipDirectPaidBreakdownForMtd = !!(monthToDateCutoffDay && mtdAltegioLocationId);

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
            if (g.attendanceStatus === 'arrived' || g.attendance === 1 || g.attendance === 2) {
              ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned').consultAttended += 1;
            }
          }
          if (g.groupType === 'paid' && (g.attendanceStatus === 'arrived' || g.attendance === 1 || g.attendance === 2)) {
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

      // Грошові колонки C/D/F/G у «Записи Майбутні» по букінг-даті (Kyiv) з paidServiceVisitBreakdown / paidServiceTotalCost.
      // C — лише вже відвідані записи у вікні від 1-го числа місяця до сьогодні (або кінця місяця, якщо обрано минулий).
      if (todayKyivDay && month) {
        const paidBreakdown = getPaidSumBreakdown({
          paidServiceVisitBreakdown: c.paidServiceVisitBreakdown,
          paidServiceTotalCost: c.paidServiceTotalCost,
        });
        const hasNamedPaidBreakdown = paidBreakdown.some((entry) => entry.masterName);
        const addPaidBreakdownToField = (
          field: 'futureSum' | 'monthToEndSum' | 'nextMonthSum' | 'plus2MonthSum' | 'turnoverMonthToDateUAH'
        ) => {
          if (paidBreakdown.length === 0) return;
          if (hasNamedPaidBreakdown) {
            for (const entry of paidBreakdown) {
              const mid = mapStaffToMasterId({ staffId: null, staffName: entry.masterName });
              const row = ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned');
              row[field] += entry.sumUAH;
            }
            return;
          }
          const mid = mapStaffToMasterId({
            staffId: c.serviceMasterAltegioStaffId ?? null,
            staffName: c.serviceMasterName || '',
          });
          const row = ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned');
          row[field] += paidBreakdown[0]?.sumUAH || 0;
        };

        const paidDay = c.paidServiceDate ? kyivDayFromISO(c.paidServiceDate.toISOString()) : '';
        const paidMonth = paidDay ? paidDay.slice(0, 7) : '';
        const isSelectedFutureMonth = month > todayMonthKey;
        const isSelectedCurrentMonth = month === todayMonthKey;
        const isFutureWithinSelectedMonth =
          !!paidDay &&
          paidMonth === month &&
          (
            (isSelectedCurrentMonth && paidDay > todayKyivDay) ||
            isSelectedFutureMonth
          );

        if (isFutureWithinSelectedMonth) {
          addPaidBreakdownToField('futureSum');
          addPaidBreakdownToField('monthToEndSum');
        }
        if (paidMonth === nextMonthKey) {
          addPaidBreakdownToField('nextMonthSum');
        }
        if (paidMonth === plus2MonthKey) {
          addPaidBreakdownToField('plus2MonthSum');
        }

        const isMtdAttendedVisitInWindow =
          !!monthToDateCutoffDay &&
          !!paidDay &&
          paidMonth === month &&
          paidDay <= monthToDateCutoffDay &&
          c.paidServiceAttended === true;
        if (isMtdAttendedVisitInWindow && !skipDirectPaidBreakdownForMtd) {
          addPaidBreakdownToField('turnoverMonthToDateUAH');
        }
      }

      // KPI суми по KV лишаємо для категорій/атрибуції по місяцю.
      // Колонка МТД (turnoverMonthToDateUAH): при skipDirectPaidBreakdownForMtd — лише блок Altegio нижче; інакше — paid з Direct вище.
      if (todayKyivDay && month && groups.length) {
        const paidGroupsAll = groups.filter((g: any) => g?.groupType === 'paid' && (g?.kyivDay || ''));
        for (const g of paidGroupsAll) {
          const gDay: string = (g?.kyivDay || '').toString();
          if (!gDay) continue;
          const gMonth = gDay.slice(0, 7);

          const fromEvents = computeGroupTotalCostUAH(g);
          const fromServices = computeServicesTotalCostUAH(g?.services || []);
          const totalCost = Math.max(fromEvents, fromServices);
          if (!totalCost || totalCost <= 0) continue;

          const staffForSum = pickStaffForSums(g);
          const mid = mapStaffToMasterId(staffForSum);
          const row = ensureRow(mid, rowsByMasterId.get(mid)?.masterName || 'Без майстра', rowsByMasterId.get(mid)?.role || 'unassigned');
        }
      }

      // Послуги / Волосся / Товар — по майстрах з paid-груп у вибраному місяці (attended)
      const paidGroupsInMonth = groups.filter(
        (g: any) => g?.groupType === 'paid' && (g?.kyivDay || '').slice(0, 7) === month && (g?.attendanceStatus === 'arrived' || g?.attendance === 1 || g?.attendance === 2)
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

    // Колонка «З початку місяця»: при наявності ALTEGIO_COMPANY_ID — лише Altegio (income_daily → records → Z → payroll),
    // без paidServiceVisitBreakdown з Direct; інакше — Direct paid у вікні МТД.
    let altegioMtdReplacements = 0;
    let altegioMtdFromRecords = 0;
    let altegioMtdFromIncomeDaily = 0;
    let altegioMtdZReportDaysOk = 0;
    let altegioMtdFromDaily = 0;
    let altegioMtdFromCalculationFallback = 0;
    if (monthToDateCutoffDay) {
      const locationId = mtdAltegioLocationId;
      if (locationId) {
        for (const r of rowsByMasterId.values()) {
          r.turnoverMonthToDateUAH = 0;
        }
        const mastersWithStaff = masters.filter(
          (m) => typeof m.altegioStaffId === 'number' && Number.isFinite(m.altegioStaffId) && m.altegioStaffId > 0,
        );

        let mtdSettled = false;
        /** Для відповіді debug та логів: як зібрано МТД. */
        let mtdStrategy:
          | 'income_full'
          | 'income_records_merge'
          | 'records_only'
          | 'z_report'
          | 'payroll'
          | 'none' = 'none';

        const incomeByStaffId = new Map<number, Awaited<ReturnType<typeof fetchMasterRevenueFromIncomeDailyChart>>>();
        for (const m of mastersWithStaff) {
          const inc = await fetchMasterRevenueFromIncomeDailyChart(
            locationId,
            m.altegioStaffId,
            selectedMonthBounds.start,
            monthToDateCutoffDay,
          );
          incomeByStaffId.set(m.altegioStaffId, inc);
          await new Promise((r) => setTimeout(r, 80));
        }

        const incomeOkList = mastersWithStaff.map((m) => incomeByStaffId.get(m.altegioStaffId)).filter((x) => x?.ok);
        const incomeTotals = incomeOkList.map((x) => (x!.ok ? x!.totalUAH : 0));
        const incomeOkCount = mastersWithStaff.filter(
          (m) => incomeByStaffId.get(m.altegioStaffId)?.ok === true,
        ).length;
        const incomeAllAttemptedOk =
          mastersWithStaff.length > 0 &&
          mastersWithStaff.every((m) => incomeByStaffId.get(m.altegioStaffId)?.ok === true);
        const incomeSamePositiveTotal =
          incomeTotals.length >= 2 &&
          new Set(incomeTotals).size === 1 &&
          (incomeTotals[0] ?? 0) > 0;

        let recordsMtd: Awaited<ReturnType<typeof fetchRecordsMtdTurnoverByStaffId>> | null = null;

        const applyFullRecordsMtd = (recOk: RecordsMtdOkResult): void => {
          altegioMtdReplacements = 0;
          for (const m of masters) {
            if (typeof m.altegioStaffId !== 'number' || !Number.isFinite(m.altegioStaffId) || m.altegioStaffId <= 0) {
              continue;
            }
            const v = recOk.byStaffId.get(m.altegioStaffId) ?? 0;
            ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = Math.round(v * 100) / 100;
            altegioMtdReplacements += 1;
          }
          if (altegioMtdReplacements > 0) {
            ensureRow(unassignedId, 'Без майстра', 'unassigned').turnoverMonthToDateUAH = 0;
          }
          altegioMtdFromRecords = recOk.recordsScanned;
        };

        // A) Усі income_daily успішні й не «зламаний» фільтр — як у вебі Altegio
        if (!incomeSamePositiveTotal && incomeAllAttemptedOk) {
          altegioMtdReplacements = 0;
          for (const m of mastersWithStaff) {
            const inc = incomeByStaffId.get(m.altegioStaffId)!;
            if (inc.ok) {
              ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = Math.round(inc.totalUAH * 100) / 100;
              altegioMtdReplacements += 1;
              altegioMtdFromIncomeDaily += 1;
            }
          }
          if (altegioMtdReplacements > 0) {
            ensureRow(unassignedId, 'Без майстра', 'unassigned').turnoverMonthToDateUAH = 0;
          }
          mtdSettled = true;
          mtdStrategy = 'income_full';
          console.log('[direct/masters-stats] 📈 МТД: income_daily + team_member_id (усі майстри)', {
            month,
            locationId,
            periodStart: selectedMonthBounds.start,
            periodEnd: monthToDateCutoffDay,
            altegioMtdReplacements,
            altegioMtdFromIncomeDaily,
            mastersWithAltegioStaffId: mastersWithStaff.length,
          });
        } else if (!incomeSamePositiveTotal && incomeOkCount > 0) {
          // B) Частина income_daily успішна — не скидати всіх на records/Z; добираємо з GET /records по staff_id
          recordsMtd = await fetchRecordsMtdTurnoverByStaffId(
            locationId,
            selectedMonthBounds.start,
            monthToDateCutoffDay,
            { countPerPage: 100, delayMs: 100, maxPages: 200 },
          );
          const recOk = recordsMtd.ok ? recordsMtd : null;
          altegioMtdReplacements = 0;
          for (const m of mastersWithStaff) {
            const inc = incomeByStaffId.get(m.altegioStaffId);
            if (inc?.ok) {
              ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = Math.round(inc.totalUAH * 100) / 100;
              altegioMtdFromIncomeDaily += 1;
            } else {
              const v = recOk?.byStaffId.get(m.altegioStaffId) ?? 0;
              ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = Math.round(v * 100) / 100;
            }
            altegioMtdReplacements += 1;
          }
          if (recOk) {
            altegioMtdFromRecords = recOk.recordsScanned;
          }
          if (altegioMtdReplacements > 0) {
            ensureRow(unassignedId, 'Без майстра', 'unassigned').turnoverMonthToDateUAH = 0;
          }
          mtdSettled = true;
          mtdStrategy = 'income_records_merge';
          console.log('[direct/masters-stats] 📈 МТД: income_daily + GET /records (гібрид по майстру)', {
            month,
            locationId,
            periodStart: selectedMonthBounds.start,
            periodEnd: monthToDateCutoffDay,
            incomeOkCount,
            mastersWithStaff: mastersWithStaff.length,
            recordsOk: recordsMtd.ok,
            recordsScanned: recordsMtd.ok ? recordsMtd.recordsScanned : undefined,
          });
        } else if (!incomeSamePositiveTotal && mastersWithStaff.length > 0) {
          // C) Усі запити income_daily впали — повний fallback на /records
          recordsMtd = await fetchRecordsMtdTurnoverByStaffId(
            locationId,
            selectedMonthBounds.start,
            monthToDateCutoffDay,
            { countPerPage: 100, delayMs: 100, maxPages: 200 },
          );
          const recOk = recordsMtd.ok ? recordsMtd : null;
          const useRecordsMtd =
            recOk != null && recOk.recordsScanned > 0 && recOk.byStaffId.size > 0;
          if (useRecordsMtd && recOk) {
            applyFullRecordsMtd(recOk);
            mtdSettled = true;
            mtdStrategy = 'records_only';
            console.log('[direct/masters-stats] 📈 МТД: GET /records (усі income_daily недоступні)', {
              month,
              locationId,
              altegioMtdReplacements,
              recordsScanned: recOk.recordsScanned,
            });
          }
        } else if (incomeSamePositiveTotal) {
          console.warn(
            '[direct/masters-stats] ⚠️ МТД: income_daily однакова сума для всіх майстрів — ігноруємо income, records / Z',
            { month, locationId, sampleTotal: incomeTotals[0] },
          );
        }

        if (!mtdSettled && incomeSamePositiveTotal && mastersWithStaff.length > 0) {
          if (recordsMtd == null) {
            recordsMtd = await fetchRecordsMtdTurnoverByStaffId(
              locationId,
              selectedMonthBounds.start,
              monthToDateCutoffDay,
              { countPerPage: 100, delayMs: 100, maxPages: 200 },
            );
          }
          const recOk = recordsMtd.ok ? recordsMtd : null;
          const useRecordsMtd =
            recOk != null && recOk.recordsScanned > 0 && recOk.byStaffId.size > 0;
          if (useRecordsMtd && recOk) {
            applyFullRecordsMtd(recOk);
            mtdSettled = true;
            mtdStrategy = 'records_only';
            console.log('[direct/masters-stats] 📈 МТД: GET /records (після зламаного income_same_total)', {
              month,
              locationId,
              altegioMtdReplacements,
            });
          }
        }

        if (!mtdSettled) {
          if (!incomeSamePositiveTotal && mastersWithStaff.length > 0) {
            const recordsReason =
              recordsMtd == null
                ? 'records_not_fetched'
                : recordsMtd.ok === false
                  ? recordsMtd.reason
                  : recordsMtd.recordsScanned > 0
                    ? 'records_ok_empty_staff_map'
                    : 'records_ok_zero_scanned';
            console.warn('[direct/masters-stats] ⚠️ МТД: income / records не дали карту — Z-звіт / payroll', {
              month,
              locationId,
              recordsReason,
              recordsScanned: recordsMtd?.ok ? recordsMtd.recordsScanned : undefined,
              incomeOkCount: incomeOkList.length,
            });
          }

          const zMtd = await fetchZReportMtdTurnoverByMasterId(
            locationId,
            selectedMonthBounds.start,
            monthToDateCutoffDay,
          );

          if (zMtd.ok) {
            altegioMtdReplacements = 0;
            altegioMtdZReportDaysOk = zMtd.daysSucceeded;
            for (const m of masters) {
              if (typeof m.altegioStaffId !== 'number' || !Number.isFinite(m.altegioStaffId) || m.altegioStaffId <= 0) {
                continue;
              }
              const v = zMtd.byMasterId.get(m.altegioStaffId) ?? 0;
              ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = Math.round(v * 100) / 100;
              altegioMtdReplacements += 1;
            }
            if (altegioMtdReplacements > 0) {
              ensureRow(unassignedId, 'Без майстра', 'unassigned').turnoverMonthToDateUAH = 0;
            }
            mtdStrategy = 'z_report';
            console.log('[direct/masters-stats] 📈 МТД: Z-звіт (result_cost)', {
              month,
              locationId,
              periodStart: selectedMonthBounds.start,
              periodEnd: monthToDateCutoffDay,
              zDaysRequested: zMtd.daysRequested,
              zDaysSucceeded: zMtd.daysSucceeded,
              altegioMtdReplacements,
            });
          } else {
            const zFail = zMtd;
            console.warn('[direct/masters-stats] ⚠️ МТД: Z-звіт недоступний, payroll API', {
              month,
              locationId,
              zReason: zFail.ok === false ? zFail.reason : 'unknown',
            });
            altegioMtdReplacements = 0;
            for (const m of masters) {
              if (typeof m.altegioStaffId !== 'number' || !Number.isFinite(m.altegioStaffId) || m.altegioStaffId <= 0) {
                continue;
              }
              const dailyRes = await fetchStaffDailyPeriodTurnoverUAH(
                locationId,
                m.altegioStaffId,
                selectedMonthBounds.start,
                monthToDateCutoffDay,
              );
              const res = dailyRes.ok
                ? dailyRes
                : await fetchStaffCalculationIncomeUAH(
                    locationId,
                    m.altegioStaffId,
                    selectedMonthBounds.start,
                    monthToDateCutoffDay,
                  );
              if (res.ok) {
                altegioMtdReplacements += 1;
                if (dailyRes.ok) altegioMtdFromDaily += 1;
                else altegioMtdFromCalculationFallback += 1;
                ensureRow(m.id, m.name, m.role).turnoverMonthToDateUAH = res.incomeUAH;
              }
              await new Promise((r) => setTimeout(r, 120));
            }
            if (altegioMtdReplacements > 0) {
              ensureRow(unassignedId, 'Без майстра', 'unassigned').turnoverMonthToDateUAH = 0;
            }
            mtdStrategy = 'payroll';
            console.log('[direct/masters-stats] 📈 МТД: payroll daily/calculation', {
              month,
              locationId,
              altegioMtdReplacements,
              altegioMtdFromDaily,
              altegioMtdFromCalculationFallback,
            });
          }
        }
        mtdApiDebug = {
          strategy: mtdStrategy,
          incomeOkCount,
          incomeSamePositiveTotal,
          mastersWithStaff: mastersWithStaff.length,
          altegioOnlyMtd: skipDirectPaidBreakdownForMtd,
        };
      } else {
        console.warn(
          '[direct/masters-stats] ⚠️ МТД колонка C: немає location id (ALTEGIO_COMPANY_ID / PARTNER_ID) — лише Direct fallback',
        );
      }
    }

    const turnoverMonthToDateSumUAH = [...rowsByMasterId.values()].reduce(
      (s, r) => s + (r.turnoverMonthToDateUAH || 0),
      0,
    );
    if (monthToDateCutoffDay) {
      console.log('[direct/masters-stats] 📊 Підсумок turnoverMonthToDateUAH після Altegio/Direct', {
        month,
        periodStart: selectedMonthBounds.start,
        periodEnd: monthToDateCutoffDay,
        turnoverMonthToDateSumUAH,
        altegioMtdReplacements,
        altegioMtdFromRecords,
        altegioMtdFromIncomeDaily,
        altegioMtdZReportDaysOk,
        altegioMtdFromDaily,
        altegioMtdFromCalculationFallback,
      });
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
    const excelDisplayNames = ['Галина', 'Олена', 'Маряна', 'Олександра'];
    const allRowsForExcel = [...mastersRows, unassignedRow];
    const excelRows = excelDisplayNames.map((excelName) => {
      const key = normalizeExcelMatchKey(excelName);
      const matched = allRowsForExcel.find((row) => normalizeExcelMatchKey(row.masterName) === key) || null;
      return { excelName, data: matched };
    });

    // totalClients = кількість клієнтів після фільтрів (statusId, masterId, source, search, hasAppointment).
    // Без параметрів = усі з findMany. Щоб збігалось з Direct — там totalCount з GET /api/admin/direct/clients (COUNT(*)).
    return NextResponse.json({
      ok: true,
      month,
      totalClients: filteredClients.length,
      masters: mastersRows,
      unassigned: unassignedRow,
      excelRows,
      debug: {
        mastersCount: masters.length,
        filteredClientsCount: filteredClients.length,
        normalizedEventsCount: normalizedEvents.length,
        groupsByClientCount: groupsByClient.size,
        mtd: mtdApiDebug ?? null,
      },
    });
  } catch (error) {
    console.error('[direct/masters-stats] ❌ Error:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

