// web/app/api/admin/direct/clients/route.ts
// API endpoint для роботи з Direct клієнтами

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import {
  getAllDirectClients,
  saveDirectClient,
  getAllDirectStatuses,
  isTransientDirectDbFailure,
  isConnectionLevelDbFailure,
  directKyivDayColumnsExist,
} from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDisplayedState } from '@/lib/direct-displayed-state';
import { isKyivCalendarDayEqualToReference } from '@/lib/direct-kyiv-today';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { computePeriodStats } from '@/lib/direct-period-stats';
import { getTodayKyiv, getKyivDayUtcBounds } from '@/lib/direct-stats-config';
import { normalizePhone } from '@/lib/binotel/normalize-phone';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { buildLightweightWhereSqlFragment } from '@/lib/direct-clients-lightweight-sql';
import { normalizeNameForComparison } from '@/lib/name-normalize';
import {
  computeGlobalColumnFilterAggregatesFromClients,
  emptyGlobalColumnFilterAggregates,
} from '@/lib/direct-global-filter-counts';
import { buildGlobalMasterFilterPanelCounts, emptyGlobalMasterFilterPanelCounts } from '@/lib/master-filter-utils';
import { computeBinotelCallsFilterCountsFromDb } from '@/lib/direct-binotel-filter-counts';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
/** Один раз у логах: lightweight недоступний без міграції *KyivDay. */
let loggedDirectClientsLightweightSkippedKyiv = false;
const STATS_CACHE_TTL_MS = 30_000;
const statsOnlyCache = new Map<string, { expiresAt: number; payload: any }>();

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  // Перевірка через ADMIN_PASS (кука)
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // User session (AppUser)
  if (verifyUserToken(adminToken)) return true;

  // Перевірка через CRON_SECRET
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  // Якщо нічого не налаштовано, дозволяємо (для розробки)
  if (!ADMIN_PASS && !CRON_SECRET) return true;

  return false;
}

/**
 * Повтори запиту до БД у lightweight-гілці (cold start Neon, P1001, пул з'єднань).
 */
async function withDirectClientsDbRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delaysMs = [0, 500, 1200, 2500];
  let last: unknown;
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
    try {
      return await fn();
    } catch (e) {
      last = e;
      // PrismaClientInitializationError / P1001 на db.prisma.io — повтори не допоможуть (той самий URL).
      if (isConnectionLevelDbFailure(e)) {
        console.warn(
          `[direct/clients] ${label}: недоступність БД на рівні з'єднання — без повторів`,
          e instanceof Error ? e.message : e
        );
        throw e;
      }
      if (isTransientDirectDbFailure(e) && i < delaysMs.length - 1) {
        console.warn(
          `[direct/clients] ${label}: транзієнтна помилка БД, спроба ${i + 1}/${delaysMs.length}, повтор...`,
          e
        );
        continue;
      }
      throw e;
    }
  }
  throw last;
}

/**
 * Отримати дату останнього візиту для підрахунку daysSinceLastVisit.
 * Беремо max(найновіша attended-дата, lastVisitAt), щоб не показувати більше днів ніж
 * фактичний останній візит з Altegio (lastVisitAt). Це фіксує невідповідність, коли
 * lastVisitAt оновлено (10.01.2026), а attended-дати старіші (напр. червень 2025).
 */
function getLastAttendedVisitDate(c: {
  consultationAttended?: boolean | null;
  consultationAttendanceValue?: 1 | 2 | null;
  consultationDate?: Date | string | null;
  consultationBookingDate?: Date | string | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: 1 | 2 | null;
  paidServiceDate?: Date | string | null;
  lastVisitAt?: Date | string | null;
}): string {
  const dates: string[] = [];
  if (c.consultationAttended === true && c.consultationAttendanceValue === 1) {
    const d = c.consultationDate ?? c.consultationBookingDate;
    const iso = (typeof d === 'string' ? d : (d as Date)?.toISOString?.()) || '';
    if (iso) dates.push(iso);
  }
  if (c.paidServiceAttended === true && c.paidServiceAttendanceValue === 1 && c.paidServiceDate) {
    const iso = (typeof c.paidServiceDate === 'string' ? c.paidServiceDate : (c.paidServiceDate as Date)?.toISOString?.()) || '';
    if (iso) dates.push(iso);
  }
  let iso = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
  if (!iso) iso = ((c as any).lastVisitAt || '').toString().trim();
  // Беремо max з lastVisitAt — lastVisitAt з Altegio є авторитетним джерелом
  const lastVisitStr = ((c as any).lastVisitAt || '').toString().trim();
  if (lastVisitStr && (!iso || lastVisitStr > iso)) iso = lastVisitStr;
  return iso;
}

/**
 * Лічильники фільтра «Днів» по всій вибірці клієнтів (та сама логіка, що daysCountsOnly / колонка Днів).
 * `clientsForDays` — мінімальний набір полів для getLastAttendedVisitDate або повний DirectClient.
 */
function computeGlobalDaysCountsFromClients(
  /** Prisma `select` або повний DirectClient — getLastAttendedVisitDate читає лише потрібні поля. */
  clientsForDays: ReadonlyArray<Record<string, unknown>>
): { none: number; growing: number; grown: number; overgrown: number } {
  const daysCounts = { none: 0, growing: 0, grown: 0, overgrown: 0 };
  const todayKyivDay = kyivDayFromISO(new Date().toISOString());
  const toDayIndex = (day: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
    if (!m) return NaN;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return NaN;
    return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  };
  const todayIdx = toDayIndex(todayKyivDay);
  if (!Number.isFinite(todayIdx)) {
    return daysCounts;
  }
  for (const c of clientsForDays) {
    const iso = getLastAttendedVisitDate(c as Parameters<typeof getLastAttendedVisitDate>[0]);
    if (!iso) {
      daysCounts.none++;
      continue;
    }
    const day = kyivDayFromISO(iso);
    const idx = toDayIndex(day);
    if (!Number.isFinite(idx)) {
      daysCounts.none++;
      continue;
    }
    const diff = todayIdx - idx;
    const d = diff < 0 ? 0 : diff;
    if (d >= 90) daysCounts.overgrown++;
    else if (d >= 60) daysCounts.grown++;
    else if (d >= 0) daysCounts.growing++;
    else daysCounts.none++;
  }
  return daysCounts;
}

/** Колонка «Днів»: daysSinceLastVisit (Europe/Kyiv), та сама логіка, що й у heavy-шляху. */
function enrichClientsWithDaysSinceLastVisitField<T>(clients: T[]): T[] {
  try {
    const todayKyivDay = kyivDayFromISO(new Date().toISOString());
    const toDayIndex = (day: string): number => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
      if (!m) return NaN;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (!y || !mo || !d) return NaN;
      return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
    };
    const todayIdx = toDayIndex(todayKyivDay);
    if (!Number.isFinite(todayIdx)) {
      return clients;
    }

    return clients.map((c) => {
      const iso = getLastAttendedVisitDate(c as any);
      if (!iso) {
        return { ...c, daysSinceLastVisit: undefined } as T;
      }
      const day = kyivDayFromISO(iso);
      const idx = toDayIndex(day);

      if (!Number.isFinite(idx)) {
        return { ...c, daysSinceLastVisit: undefined } as T;
      }
      const diff = todayIdx - idx;
      const daysSinceLastVisit = diff < 0 ? 0 : diff;

      return { ...c, daysSinceLastVisit } as T;
    });
  } catch (err) {
    console.warn('[direct/clients] ⚠️ Не вдалося порахувати daysSinceLastVisit (не критично):', err);
    return clients;
  }
}

/** Глобальні лічильники статусів по всій вибірці direct_clients (для панелі фільтрів). */
function buildGlobalStatusCountsFromClients(all: DirectClient[]): Record<string, number> {
  const statusCounts: Record<string, number> = {};
  for (const c of all) {
    const sid = (c.statusId || '').toString().trim();
    if (sid) statusCounts[sid] = (statusCounts[sid] ?? 0) + 1;
  }
  return statusCounts;
}

function toSerializableDirectClient(row: Record<string, any>): DirectClient {
  const toSafeJson = (value: any): any => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => toSafeJson(item));
    if (typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = toSafeJson(v);
      return out;
    }
    return value;
  };

  const safeRow = toSafeJson(row) as Record<string, any>;
  const serializeDate = (v: unknown): string | undefined => {
    if (!v) return undefined;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
    if (typeof v === 'string') return v;
    return undefined;
  };

  return {
    ...(safeRow as any),
    firstContactDate: serializeDate(safeRow.firstContactDate) || new Date().toISOString(),
    createdAt: serializeDate(safeRow.createdAt) || new Date().toISOString(),
    updatedAt: serializeDate(safeRow.updatedAt) || new Date().toISOString(),
    lastVisitAt: serializeDate(safeRow.lastVisitAt),
    lastActivityAt: serializeDate(safeRow.lastActivityAt),
    visitDate: serializeDate(safeRow.visitDate),
    consultationDate: serializeDate(safeRow.consultationDate),
    consultationBookingDate: serializeDate((safeRow as any).consultationBookingDate),
    consultationRecordCreatedAt: serializeDate((safeRow as any).consultationRecordCreatedAt),
    consultationAttendanceSetAt: serializeDate((safeRow as any).consultationAttendanceSetAt),
    paidServiceDate: serializeDate(safeRow.paidServiceDate),
    paidServiceRecordCreatedAt: serializeDate((safeRow as any).paidServiceRecordCreatedAt),
    paidServiceAttendanceSetAt: serializeDate((safeRow as any).paidServiceAttendanceSetAt),
    chatStatusSetAt: serializeDate((safeRow as any).chatStatusSetAt),
    chatStatusCheckedAt: serializeDate((safeRow as any).chatStatusCheckedAt),
    chatStatusAnchorMessageReceivedAt: serializeDate((safeRow as any).chatStatusAnchorMessageReceivedAt),
    chatStatusAnchorSetAt: serializeDate((safeRow as any).chatStatusAnchorSetAt),
    callStatusSetAt: serializeDate((safeRow as any).callStatusSetAt),
    lastMessageAt: serializeDate((safeRow as any).lastMessageAt),
    statusSetAt: serializeDate((safeRow as any).statusSetAt),
  } as DirectClient;
}

/**
 * Поля orderBy для lightweight (Prisma) + псевдоніми колонок UI, що в heavy-шляху обчислюються інакше.
 * Якщо sortBy не підтримано — увімкнеться getAllDirectClients() (навантаження всієї бази).
 */
const LIGHTWEIGHT_SORT_COLUMN: Record<string, string> = {
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  firstContactDate: 'firstContactDate',
  lastMessageAt: 'lastMessageAt',
  instagramUsername: 'instagramUsername',
  consultationBookingDate: 'consultationBookingDate',
  paidServiceDate: 'paidServiceDate',
  spent: 'spent',
  masterId: 'masterId',
  statusId: 'statusId',
  state: 'state',
  lastVisitAt: 'lastVisitAt',
  daysSinceLastVisit: 'lastVisitAt',
  messagesTotal: 'lastMessageAt',
};

function isLightweightSortSupported(sortByRaw: string): boolean {
  return Object.prototype.hasOwnProperty.call(LIGHTWEIGHT_SORT_COLUMN, sortByRaw);
}

function getLightweightOrder(sortByRaw: string, sortOrderRaw: string) {
  const col = LIGHTWEIGHT_SORT_COLUMN[sortByRaw] ?? 'updatedAt';
  const sortOrder: Prisma.SortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  return { [col]: sortOrder } as Prisma.DirectClientOrderByWithRelationInput;
}

function requiresNormalizedNameSearch(searchQuery: string): boolean {
  const raw = (searchQuery || '').trim().toLowerCase();
  if (!raw) return false;
  const normalized = normalizeNameForComparison(searchQuery);
  return Boolean(normalized) && normalized !== raw;
}

function buildLightweightWhere(params: {
  statusId: string | null;
  statusIds: string[];
  masterId: string | null;
  source: string | null;
  hasAppointment: string | null;
  searchQuery: string;
}): Prisma.DirectClientWhereInput {
  const where: Prisma.DirectClientWhereInput = {};
  if (params.statusIds.length > 0) {
    where.statusId = { in: params.statusIds };
  } else if (params.statusId) {
    where.statusId = params.statusId;
  }
  if (params.masterId) where.masterId = params.masterId;
  if (params.source) where.source = params.source as any;
  if (params.hasAppointment === 'true') where.paidServiceDate = { not: null };
  if (params.searchQuery) {
    const q = params.searchQuery.trim();
    const terms = q.split(/\s+/).filter(Boolean);
    const buildTermClause = (term: string): Prisma.DirectClientWhereInput => ({
      OR: [
        { instagramUsername: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ],
    });

    if (terms.length > 1) {
      where.AND = terms.map(buildTermClause);
    } else {
      where.OR = buildTermClause(q).OR;
    }
  }
  return where;
}

function getStatsCacheKey(searchParams: URLSearchParams): string {
  const copy = new URLSearchParams(searchParams.toString());
  copy.delete('_t');
  return copy.toString();
}

/**
 * GET - отримати список клієнтів з фільтрами та сортуванням
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[direct/clients] GET apiRevision=2026-03-27-v4 web-vercel-json');

  try {
    const kyivCols = await directKyivDayColumnsExist();
    const { searchParams } = req.nextUrl;
    const totalOnly = searchParams.get('totalOnly') === '1';
    const statsOnly = searchParams.get('statsOnly') === '1';
    const lightweight = searchParams.get('lightweight') === '1';
    const statsFullPicture = searchParams.get('statsFullPicture') === '1';
    const filterCountsOnly = searchParams.get('filterCountsOnly') === '1';
    /** Не рахувати глобальні лічильники колонок/Binotel у цій відповіді — швидкий список; UI підтягує ?filterCountsOnly=1 окремо. */
    const skipPanelCounts = searchParams.get('skipPanelCounts') === '1';
    const statusId = searchParams.get('statusId');
    const statusIdsRaw = searchParams.get('statusIds');
    const statusIds = statusIdsRaw ? (statusIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)) : [];
    const masterId = searchParams.get('masterId');
    const source = searchParams.get('source');
    const hasAppointment = searchParams.get('hasAppointment');
    const actMode = searchParams.get('actMode');
    const actYear = searchParams.get('actYear');
    const actMonth = searchParams.get('actMonth');
    /** trim — уникнення зламаного матчу через пробіли в query */
    const daysTrimmed = (searchParams.get('days') || '').trim();
    const daysFilter: string | null = daysTrimmed === '' ? null : daysTrimmed;
    const instFilter = searchParams.get('inst');
    const stateFilter = searchParams.get('state');
    const consultCreatedMode = searchParams.get('consultCreatedMode');
    const consultCreatedYear = searchParams.get('consultCreatedYear');
    const consultCreatedMonth = searchParams.get('consultCreatedMonth');
    const consultAppointedMode = searchParams.get('consultAppointedMode');
    const consultAppointedYear = searchParams.get('consultAppointedYear');
    const consultAppointedMonth = searchParams.get('consultAppointedMonth');
    const consultCreatedPreset = searchParams.get('consultCreatedPreset');
    const consultAppointedPreset = searchParams.get('consultAppointedPreset');
    const consultAttendance = searchParams.get('consultAttendance');
    const consultType = searchParams.get('consultType');
    const consultMasters = searchParams.get('consultMasters');
    const consultHasConsultation = searchParams.get('consultHasConsultation');
    const recordCreatedMode = searchParams.get('recordCreatedMode');
    const recordCreatedYear = searchParams.get('recordCreatedYear');
    const recordCreatedMonth = searchParams.get('recordCreatedMonth');
    const recordCreatedPreset = searchParams.get('recordCreatedPreset');
    const recordAppointedMode = searchParams.get('recordAppointedMode');
    const recordAppointedYear = searchParams.get('recordAppointedYear');
    const recordAppointedMonth = searchParams.get('recordAppointedMonth');
    const recordAppointedPreset = searchParams.get('recordAppointedPreset');
    const callbackReminderPresetRaw = searchParams.get('callbackReminderPreset');
    const callbackReminderPreset =
      callbackReminderPresetRaw === 'past' ||
      callbackReminderPresetRaw === 'today' ||
      callbackReminderPresetRaw === 'future'
        ? callbackReminderPresetRaw
        : null;
    const recordClient = searchParams.get('recordClient');
    const recordSum = searchParams.get('recordSum');
    const recordHasRecord = searchParams.get('recordHasRecord');
    const recordNewClient = searchParams.get('recordNewClient');
    const masterHands = searchParams.get('masterHands');
    const masterPrimary = searchParams.get('masterPrimary');
    const masterSecondary = searchParams.get('masterSecondary');
    const binotelCallsDirection = searchParams.get('binotelCallsDirection'); // 'incoming' | 'outgoing' | 'incoming,outgoing'
    const binotelCallsOutcome = searchParams.get('binotelCallsOutcome'); // 'success' | 'fail' | 'success,fail'
    const binotelCallsOnlyNew = searchParams.get('binotelCallsOnlyNew') === 'true';
    // Пробіли/регістр у query (браузер, копіпаст) інакше ламають `columnFilterMode !== 'and'` та isLightweightSortSupported → зайвий heavy path.
    const columnFilterMode = ((searchParams.get('columnFilterMode') || 'and').trim().toLowerCase() === 'or' ? 'or' : 'and') as 'or' | 'and';
    let sortBy = (searchParams.get('sortBy') || 'updatedAt').trim();
    const sortOrder = (searchParams.get('sortOrder') || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

    // Старі поля (дублювались в UI). Сортування по них більше не підтримуємо.
    // Payload лишаємо без змін, але sortBy примусово переводимо на updatedAt.
    const legacySortBy = new Set([
      'signedUpForPaidServiceAfterConsultation',
      'visitedSalon',
      'visitDate',
      'signedUpForPaidService',
      'signupAdmin',
    ]);
    if (legacySortBy.has(sortBy)) {
      console.warn(
        `[direct/clients] ⚠️ Отримано застарілий sortBy="${sortBy}". Використовую fallback: sortBy="updatedAt".`
      );
      sortBy = 'updatedAt';
    }

    // Lightweight-шлях для списку: SQL-пагінація + без важкого enrich.
    // Дозволяємо примусово для "простого" табличного запиту з limit/offset,
    // щоб не тягнути всю базу в heavy-шляху.
    const searchQuery = (searchParams.get('search') || '').trim();
    const lightweightLimitParam = searchParams.get('limit');
    const lightweightOffsetParam = searchParams.get('offset');
    const hasPageParams = lightweightLimitParam != null || lightweightOffsetParam != null;
    /** Фільтри колонок, що застосовуються лише після getAllDirectClients (heavy path). */
    const lightweightSupportedSort = isLightweightSortSupported(sortBy);
    const clientTypeParam = (searchParams.get('clientType') || '').trim();
    const normalizedNameSearchActive = requiresNormalizedNameSearch(searchQuery);
    const heavyOnlyColumnFiltersActive =
      Boolean(actMode) ||
      Boolean(actYear) ||
      Boolean(actMonth) ||
      Boolean(daysFilter) ||
      Boolean(instFilter) ||
      Boolean(stateFilter) ||
      Boolean(consultCreatedMode) ||
      Boolean(consultCreatedYear) ||
      Boolean(consultCreatedMonth) ||
      Boolean(consultAppointedMode) ||
      Boolean(consultAppointedYear) ||
      Boolean(consultAppointedMonth) ||
      Boolean(consultCreatedPreset) ||
      Boolean(consultAppointedPreset) ||
      Boolean(consultAttendance) ||
      Boolean(consultType) ||
      Boolean(consultMasters) ||
      Boolean(consultHasConsultation) ||
      Boolean(recordCreatedMode) ||
      Boolean(recordCreatedYear) ||
      Boolean(recordCreatedMonth) ||
      Boolean(recordCreatedPreset) ||
      Boolean(recordAppointedMode) ||
      Boolean(recordAppointedYear) ||
      Boolean(recordAppointedMonth) ||
      Boolean(recordAppointedPreset) ||
      Boolean(callbackReminderPreset) ||
      Boolean(recordClient) ||
      Boolean(recordSum) ||
      Boolean(recordHasRecord) ||
      Boolean(recordNewClient) ||
      Boolean(masterHands) ||
      Boolean(masterPrimary) ||
      Boolean(masterSecondary) ||
      Boolean(binotelCallsDirection) ||
      Boolean(binotelCallsOutcome) ||
      binotelCallsOnlyNew ||
      columnFilterMode !== 'and' ||
      !lightweightSupportedSort ||
      Boolean(clientTypeParam) ||
      normalizedNameSearchActive;
    const canForcePagedSql = hasPageParams && !heavyOnlyColumnFiltersActive;
    // lightweight=1 інакше ігнорував би Act та інші колонкові фільтри (buildLightweightWhere їх не містить).
    if (lightweight && heavyOnlyColumnFiltersActive) {
      console.log('[direct/clients] lightweight пропущено: є фільтри лише для heavy path (actMode, state, days…)');
    }
    if ((lightweight || canForcePagedSql) && !heavyOnlyColumnFiltersActive && !statsOnly && !filterCountsOnly) {
      if (!kyivCols) {
        if (!loggedDirectClientsLightweightSkippedKyiv) {
          loggedDirectClientsLightweightSkippedKyiv = true;
          console.warn(
            '[direct/clients] lightweight пропущено: колонки *KyivDay відсутні (потрібна міграція). Використовуємо heavy path.'
          );
        }
      } else {
      try {
        const where = buildLightweightWhere({
          statusId,
          statusIds,
          masterId,
          source,
          hasAppointment,
          searchQuery,
        });

        const parsedLimit = lightweightLimitParam != null ? parseInt(lightweightLimitParam, 10) : 40;
        const parsedOffset = lightweightOffsetParam != null ? parseInt(lightweightOffsetParam, 10) : 0;
        const take = parsedLimit > 0 ? Math.min(200, parsedLimit) : 40;
        const skip = Math.max(0, parsedOffset || 0);
        const orderBy = getLightweightOrder(sortBy, sortOrder);
        /** Активний режим: букінг «сьогодні» (Kyiv) зверху без повного getAll — ORDER BY по денормалізованих колонках. */
        const activeBookingSort = sortBy === 'updatedAt' && sortOrder === 'desc';

        // Лише пагінація + COUNT + groupBy по статусах (без getAllDirectClients, без enrich повідомлень/дзвінків).
        const { rows, totalCountDb, globalStatusRows } = await withDirectClientsDbRetries(
          'lightweight-prisma',
          async () => {
            if (activeBookingSort) {
              const todayKyiv = kyivDayFromISO(new Date().toISOString());
              const whereSql = buildLightweightWhereSqlFragment({
                statusId,
                statusIds,
                masterId,
                source,
                hasAppointment,
                searchQuery,
              });
              // Узгоджено з heavy path: активне сортування за max(updatedAt, lastMessageAt), щоб діалог з новим повідомленням піднімався вгору.
              const rowsRaw = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
                SELECT * FROM "direct_clients"
                WHERE ${whereSql}
                ORDER BY
                  CASE WHEN ("consultationBookingKyivDay" = ${todayKyiv} OR "paidServiceKyivDay" = ${todayKyiv} OR "callbackReminderKyivDay" = ${todayKyiv}) THEN 0 ELSE 1 END,
                  GREATEST("updatedAt", COALESCE("lastMessageAt", TIMESTAMP '1970-01-01')) DESC
                LIMIT ${take} OFFSET ${skip}
              `);
              const countRows = await prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
                SELECT COUNT(*)::bigint AS count FROM "direct_clients" WHERE ${whereSql}
              `);
              const totalCountDb = Number(countRows[0]?.count ?? 0);
              const globalStatusRows = await prisma.directClient.groupBy({
                by: ['statusId'],
                _count: { id: true },
                where: {},
              });
              return { rows: rowsRaw, totalCountDb, globalStatusRows };
            }
            const rows = await prisma.directClient.findMany({ where, orderBy, skip, take });
            const totalCountDb = await prisma.directClient.count({ where });
            const globalStatusRows = await prisma.directClient.groupBy({
              by: ['statusId'],
              _count: { id: true },
              where: {},
            });
            return { rows, totalCountDb, globalStatusRows };
          }
        );

        const statusCounts: Record<string, number> = {};
        for (const r of globalStatusRows) {
          const sid = (r.statusId || '').toString().trim();
          if (sid) statusCounts[sid] = Number(r._count.id || 0);
        }

        const serializedLight = rows.map((row) => toSerializableDirectClient(row as any));
        const clientsLight = enrichClientsWithDaysSinceLastVisitField(serializedLight);

        /** Глобальні лічильники колонкових фільтрів по всій базі (не лише по поточній сторінці). */
        let globalFilterAgg = emptyGlobalColumnFilterAggregates();
        let masterFilterPanelCounts = emptyGlobalMasterFilterPanelCounts();
        let binotelCallsFilterCountsLight = {
          incoming: 0,
          outgoing: 0,
          success: 0,
          fail: 0,
          onlyNew: 0,
        };
        if (!skipPanelCounts) {
          try {
            const allRows = await prisma.directClient.findMany();
            const allClients = allRows.map((row) => toSerializableDirectClient(row as Record<string, any>));
            globalFilterAgg = computeGlobalColumnFilterAggregatesFromClients(allClients);
            let mastersList: { id: string; name: string }[] = [];
            try {
              const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
              const dms = await getAllDirectMasters();
              mastersList = dms.map((m: { id: string; name?: string }) => ({
                id: m.id,
                name: (m.name || '').toString(),
              }));
            } catch {
              const { getMasters } = await import('@/lib/photo-reports/service');
              mastersList = getMasters().map((m: { id: string; name?: string }) => ({
                id: m.id,
                name: (m.name || '').toString(),
              }));
            }
            masterFilterPanelCounts = buildGlobalMasterFilterPanelCounts(allClients, mastersList);
          } catch (globalAggErr) {
            console.warn(
              '[direct/clients] lightweight: глобальні лічильники фільтрів по всій базі не вдались:',
              globalAggErr instanceof Error ? globalAggErr.message : globalAggErr
            );
          }

          binotelCallsFilterCountsLight = await computeBinotelCallsFilterCountsFromDb();
        } else {
          console.log('[direct/clients] lightweight: skipPanelCounts=1 — без findMany по всій базі / Binotel у цій відповіді');
        }

        return NextResponse.json(
          {
            ok: true,
            lightweight: true,
            clients: clientsLight,
            totalCount: totalCountDb,
            statusCounts,
            daysCounts: globalFilterAgg.daysCounts,
            stateCounts: globalFilterAgg.stateCounts,
            instCounts: globalFilterAgg.instCounts,
            clientTypeCounts: globalFilterAgg.clientTypeCounts,
            consultationCounts: globalFilterAgg.consultationCounts,
            recordCounts: globalFilterAgg.recordCounts,
            binotelCallsFilterCounts: binotelCallsFilterCountsLight,
            masterFilterPanelCounts,
            debug: {
              mode: canForcePagedSql ? 'lightweight-forced' : 'lightweight',
              take,
              skip,
              bookingKyivSort: sortBy === 'updatedAt' && sortOrder === 'desc',
              simplified: true,
            },
          },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              Pragma: 'no-cache',
            },
          }
        );
      } catch (lightweightErr) {
        // Спочатку: недоступність БД (P1001 / PrismaClientInitializationError) — без «fallback на heavy», це оманливо в логах.
        if (isConnectionLevelDbFailure(lightweightErr)) {
          console.warn(
            '[direct/clients] lightweight: недоступність БД (запит або enrich), 503 без getAllDirectClients:',
            lightweightErr instanceof Error ? lightweightErr.message : lightweightErr
          );
          return NextResponse.json(
            {
              ok: false,
              retryable: true,
              error: 'Тимчасовий збій бази даних. Спробуйте повторити запит.',
            },
            { status: 503 }
          );
        }
        console.error('[direct/clients] lightweight mode failed, fallback to heavy path:', lightweightErr);
        // Інший транзієнт (наприклад, таймаут пулу) — fallback на heavy: окремі ретраї; краще повільна відповідь, ніж порожній екран.
        if (isTransientDirectDbFailure(lightweightErr)) {
          console.warn(
            '[direct/clients] транзієнтна помилка lightweight — продовжуємо повним обходом (getAllDirectClients), без 503'
          );
        }
      }
      }
    }

    console.log('[direct/clients] GET: Fetching all clients...');
    let clients: DirectClient[] = [];
    let clientsFullForGlobalCounts: DirectClient[] = [];
    /** Глобальні лічильники статусів для панелі фільтрів (вся direct_clients, до пошуку/колонок). */
    let globalStatusCountsForFilters: Record<string, number> = {};
    let totalCount = 0;
    try {
      clients = await getAllDirectClients({ kyivDayColumnsExist: kyivCols });
      const clientsFetchedCount = clients.length;
      console.log(`[direct/clients] GET: Retrieved ${clients.length} clients from getAllDirectClients()`);
      clientsFullForGlobalCounts = clients;
      // Те саме джерело для обох екранів: totalCount = довжина списку getAllDirectClients().
      totalCount = clients.length;
      globalStatusCountsForFilters = buildGlobalStatusCountsFromClients(clientsFullForGlobalCounts);

      // Пошук по імені, прізвищу, Instagram, телефону
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        const qTerms = q.split(/\s+/).filter(Boolean);
        const qNormalized = normalizeNameForComparison(searchQuery);
        clients = clients.filter((c: DirectClient) => {
          const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
          const reverseFullName = [c.lastName, c.firstName].filter(Boolean).join(' ').toLowerCase();
          const normalizedFullName = normalizeNameForComparison([c.firstName, c.lastName].filter(Boolean).join(' '));
          const normalizedReverseFullName = normalizeNameForComparison([c.lastName, c.firstName].filter(Boolean).join(' '));
          const normalizedFirstName = normalizeNameForComparison(c.firstName || '');
          const normalizedLastName = normalizeNameForComparison(c.lastName || '');
          const inst = (c.instagramUsername || '').toLowerCase();
          const phone = (c.phone || '').replace(/\D/g, '');
          const termMatch = qTerms.length > 1
            ? qTerms.every((term) =>
                fullName.includes(term) ||
                reverseFullName.includes(term) ||
                inst.includes(term) ||
                ((term.replace(/\D/g, '').length >= 2) && phone.includes(term.replace(/\D/g, '')))
              )
            : false;
          return (
            fullName.includes(q) ||
            reverseFullName.includes(q) ||
            (qNormalized ? normalizedFullName.includes(qNormalized) : false) ||
            (qNormalized ? normalizedReverseFullName.includes(qNormalized) : false) ||
            (qNormalized ? normalizedFirstName.includes(qNormalized) : false) ||
            (qNormalized ? normalizedLastName.includes(qNormalized) : false) ||
            termMatch ||
            (c.firstName && c.firstName.toLowerCase().includes(q)) ||
            (c.lastName && c.lastName.toLowerCase().includes(q)) ||
            inst.includes(q) ||
            (qDigits.length >= 2 && phone.includes(qDigits))
          );
        });
        totalCount = clients.length;
        console.log(`[direct/clients] GET: Після пошуку "${searchQuery}": ${clients.length} клієнтів`);
        if (clients.length === 0 && clientsFetchedCount > 0) {
          console.log(
            '[direct/clients] GET: empty-guard: пошук 0 збігів при наявних даних — без діагностики 503 (revision search-fix-2026-03-27)'
          );
        }
      }

      // Єдине джерело для "кількість клієнтів": Статистика фетчить ?totalOnly=1 і показує той самий totalCount.
      if (totalOnly) {
        return NextResponse.json({ ok: true, totalCount });
      }

      // filterCountsOnly=1 — усі counts з повної бази (Статус, Дні, Стан, Консультація, Запис, Inst, Тип клієнта)
      const statusCountsOnly = searchParams.get('statusCountsOnly') === '1';
      if (statusCountsOnly && !filterCountsOnly) {
        try {
          const rows = await prisma.directClient.groupBy({
            by: ['statusId'],
            _count: { id: true },
            where: {},
          });
          const statusCounts: Record<string, number> = {};
          let total = 0;
          for (const r of rows) {
            const sid = (r.statusId || '').toString().trim();
            if (sid) {
              statusCounts[sid] = Number(r._count.id || 0);
              total += statusCounts[sid];
            }
          }
          return NextResponse.json({ ok: true, statusCounts, totalCount: total });
        } catch (err) {
          console.warn('[direct/clients] statusCountsOnly failed:', err);
        }
      }

      // Швидкий запит тільки для daysCounts з усієї бази (для фільтра Днів)
      const daysCountsOnly = searchParams.get('daysCountsOnly') === '1';
      if (daysCountsOnly && !filterCountsOnly) {
        try {
          const daysCounts = computeGlobalDaysCountsFromClients(clientsFullForGlobalCounts);
          const total = daysCounts.none + daysCounts.growing + daysCounts.grown + daysCounts.overgrown;
          return NextResponse.json({ ok: true, daysCounts, totalCount: total });
        } catch (err) {
          console.warn('[direct/clients] daysCountsOnly failed:', err);
          return NextResponse.json({ ok: true, daysCounts: { none: 0, growing: 0, grown: 0, overgrown: 0 }, totalCount: 0 });
        }
      }

      // filterCountsOnly: швидкий ранній return без важкої обробки — уникнення таймауту на Vercel
      if (filterCountsOnly) {
        try {
          const statusCountsRows = await prisma.directClient.groupBy({
            by: ['statusId'],
            _count: { id: true },
            where: {},
          });
          const statusCounts: Record<string, number> = {};
          for (const r of statusCountsRows) {
            const sid = (r.statusId || '').toString().trim();
            if (sid) statusCounts[sid] = Number(r._count.id || 0);
          }

          const agg = computeGlobalColumnFilterAggregatesFromClients(clientsFullForGlobalCounts);
          let masterFilterPanelCounts = buildGlobalMasterFilterPanelCounts(clientsFullForGlobalCounts, []);
          try {
            let mastersList: { id: string; name: string }[] = [];
            try {
              const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
              const dms = await getAllDirectMasters();
              mastersList = dms.map((m: { id: string; name?: string }) => ({
                id: m.id,
                name: (m.name || '').toString(),
              }));
            } catch {
              const { getMasters } = await import('@/lib/photo-reports/service');
              mastersList = getMasters().map((m: { id: string; name?: string }) => ({
                id: m.id,
                name: (m.name || '').toString(),
              }));
            }
            masterFilterPanelCounts = buildGlobalMasterFilterPanelCounts(clientsFullForGlobalCounts, mastersList);
          } catch (masterPanelErr) {
            console.warn('[direct/clients] filterCountsOnly: masterFilterPanelCounts:', masterPanelErr);
          }

          const binotelCallsFilterCountsFc = await computeBinotelCallsFilterCountsFromDb();

          return NextResponse.json({
            ok: true,
            statusCounts,
            daysCounts: agg.daysCounts,
            stateCounts: agg.stateCounts,
            instCounts: agg.instCounts,
            binotelCallsFilterCounts: binotelCallsFilterCountsFc,
            clientTypeCounts: agg.clientTypeCounts,
            consultationCounts: agg.consultationCounts,
            recordCounts: agg.recordCounts,
            masterFilterPanelCounts,
            totalCount: clientsFullForGlobalCounts.length,
          });
        } catch (err) {
          console.warn('[direct/clients] filterCountsOnly failed:', err);
          return NextResponse.json({
            ok: true,
            statusCounts: {},
            daysCounts: { none: 0, growing: 0, grown: 0, overgrown: 0 },
            stateCounts: {},
            instCounts: {},
            clientTypeCounts: { leads: 0, clients: 0, consulted: 0, good: 0, stars: 0 },
            consultationCounts: {},
            recordCounts: {},
            binotelCallsFilterCounts: { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 },
            masterFilterPanelCounts: {
              handsCounts: { '2': 0, '4': 0, '6': 0 },
              primaryNames: [],
              secondaryNames: [],
            },
            totalCount: 0,
          });
        }
      }

      try {
        const withAltegio = clients.filter((c) => !!c.altegioClientId);
        const withAltegioNoName = withAltegio.filter((c) => !(c.firstName && c.firstName.trim()) && !(c.lastName && c.lastName.trim()));
        const withAltegioSourceInstagram = withAltegio.filter((c) => c.source === 'instagram').length;
      } catch {}
      // Порожній список після пошуку (0 збігів) — штатно, не плутати з збоєм читання БД.
      const emptyAfterSearchOnly = Boolean(searchQuery) && clientsFetchedCount > 0 && clients.length === 0;
      if (clients.length === 0 && !emptyAfterSearchOnly) {
        console.warn('[direct/clients] GET: WARNING - getAllDirectClients() returned empty array!');
        // Перевіряємо, чи взагалі є клієнти в базі через прямий SQL запит
        try {
          const { prisma } = await import('@/lib/prisma');
          const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*) as count FROM "direct_clients"
          `;
          const totalCount = Number(count[0]?.count || 0);
          console.log(`[direct/clients] GET: Direct SQL count query returned: ${totalCount} clients in database`);
          if (totalCount > 0) {
            console.error('[direct/clients] GET: ERROR - Database has clients but getAllDirectClients() returned empty!');
            return NextResponse.json(
              {
                ok: false,
                error: 'Тимчасовий збій читання клієнтів з БД. Спробуйте повторити запит.',
                retryable: true,
                debug: {
                  source: 'getAllDirectClients-empty-but-db-has-data',
                  totalCount,
                },
              },
              { status: 503 }
            );
          }
          // Реально порожня база (0 клієнтів) — це валідний кейс.
          // У такому разі продовжуємо штатну обробку та повернемо порожній список.
        } catch (countErr) {
          console.error('[direct/clients] GET: Failed to check database count:', countErr);
          // Не можемо підтвердити, що база дійсно порожня — віддаємо retryable-помилку,
          // щоб фронт зробив автоповтор і не показував фальшивий "Немає клієнтів".
          return NextResponse.json(
            {
              ok: false,
              retryable: true,
              error: 'Тимчасово не вдалося перевірити стан БД. Повторіть запит.',
              debug: {
                source: 'empty-clients-and-count-check-failed',
              },
            },
            { status: 503 }
          );
        }
      }
    } catch (fetchErr) {
      console.error('[direct/clients] GET: Error fetching clients:', fetchErr);
      console.error('[direct/clients] GET: Error details:', {
        message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        stack: fetchErr instanceof Error ? fetchErr.stack : undefined,
      });
      // Повертаємо retryable-помилку, щоб фронт не перетирав UI "порожніми клієнтами"
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          warning: 'Failed to fetch clients from database',
        },
        { status: 503 }
      );
    }

    // Завантажуємо статуси для сортування по назві
    const statuses = await getAllDirectStatuses();
    const statusMap = new Map(statuses.map(s => [s.id, s.name]));

    // DirectMaster: потрібен для фільтра "Майстер" (тепер це serviceMasterName) і для атрибуції перезаписів
    let directMasterIdToName = new Map<string, string>();
    let directMasterNameToId = new Map<string, string>();
    let directMasterIdToStaffId = new Map<string, number>();
    /** Той самий список, що в UI фільтра «Майстер» — для глобальних лічильників рук/імен. */
    let mastersForGlobalFilterPanel: { id: string; name: string }[] = [];
    try {
      const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
      const dms = await getAllDirectMasters();
      mastersForGlobalFilterPanel = dms.map((m: any) => ({
        id: m.id,
        name: (m.name || '').toString(),
      }));
      directMasterIdToName = new Map(dms.map((m: any) => [m.id, (m.name || '').toString()]));
      directMasterNameToId = new Map(
        dms.map((m: any) => [(m.name || '').toString().trim().toLowerCase(), m.id])
      );
      directMasterIdToStaffId = new Map(
        dms
          .filter((m: any) => typeof m.altegioStaffId === 'number')
          .map((m: any) => [m.id, m.altegioStaffId as number])
      );
    } catch (err) {
      console.warn('[direct/clients] ⚠️ Не вдалося завантажити DirectMaster (фільтр/перезапис):', err);
      try {
        const { getMasters } = await import('@/lib/photo-reports/service');
        mastersForGlobalFilterPanel = getMasters().map((m: { id: string; name?: string }) => ({
          id: m.id,
          name: (m.name || '').toString(),
        }));
      } catch (fallbackErr) {
        console.warn('[direct/clients] Fallback getMasters для masterFilterPanel теж не вдався:', fallbackErr);
      }
    }

    // Завантажуємо відповідальних для сортування по імені (якщо потрібно)
    let masterMap = new Map<string, string>();
    if (sortBy === 'masterId') {
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for sorting:', err);
        try {
          const { getMasters } = await import('@/lib/photo-reports/service');
          const masters = getMasters();
          masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
        } catch (fallbackErr) {
          console.warn('[direct/clients] Fallback to old masters also failed:', fallbackErr);
        }
      }
    }

    /** Без KV: KPI «Заплановано» у statsOnly беруться з тих самих даних БД, що й список. */
    let clientsForBookedStatsBase: DirectClient[] = [];

    // Фільтрація (statusIds застосовуємо в кінці, щоб statusCounts рахувався з усієї бази)
    if (masterId) {
      const selectedMasterName = (directMasterIdToName.get(masterId) || '').trim().toLowerCase();
      const selectedMasterFirst = selectedMasterName ? selectedMasterName.split(/\s+/)[0] : '';
      const selectedStaffId = directMasterIdToStaffId.get(masterId) ?? null;

      clients = clients.filter((c) => {
        // 1) точний матч по staffId (найнадійніше)
        if (selectedStaffId && (c.serviceMasterAltegioStaffId ?? null) === selectedStaffId) return true;

        // 2) фолбек: коли в DirectMaster тільки ім'я, а в Altegio ПІБ
        const cm = (c.serviceMasterName || '').trim().toLowerCase();
        if (!cm) return false;
        if (selectedMasterName && cm === selectedMasterName) return true;
        const clientFirst = cm.split(/\s+/)[0] || '';
        if (selectedMasterFirst && clientFirst === selectedMasterFirst) return true;
        return false;
      });
    }
    if (source) {
      clients = clients.filter((c) => c.source === source);
    }
    if (hasAppointment === 'true') {
      // Фільтруємо клієнтів з активною датою запису
      clients = clients.filter((c) => {
        return c.paidServiceDate && c.paidServiceDate.trim() !== '';
      });
    }

    // Фільтрація за clientType (AND логіка: клієнт має відповідати ВСІМ вибраним типам)
    const clientType = searchParams.get('clientType');
    if (clientType) {
      const types = clientType.split(',').filter(Boolean);
      if (types.length > 0) {
        clients = clients.filter((c) => {
          const matches: boolean[] = [];
          
          // Перевіряємо кожен вибраний фільтр
          for (const filterType of types) {
            if (filterType === 'leads') {
              matches.push(!c.altegioClientId);
            } else if (filterType === 'clients') {
              matches.push(!!c.altegioClientId);
            } else if (filterType === 'consulted') {
              matches.push(!!c.altegioClientId && (c.spent ?? 0) === 0);
            } else if (filterType === 'good') {
              const spent = c.spent ?? 0;
              matches.push(spent < 100000 && spent > 0);
            } else if (filterType === 'stars') {
              matches.push((c.spent ?? 0) >= 100000);
            }
          }

          // AND логіка: клієнт має відповідати ВСІМ вибраним типам
          return matches.length === types.length && matches.every((m) => m === true);
        });
        console.log(`[direct/clients] Filtered by clientType: ${types.join(',')}, remaining: ${clients.length}`);
      }
    }

    // Діагностика для "Юлія Кобра" та "Топоріна Олена"
    const debugClients = clients.filter(c => 
      c.instagramUsername === 'kobra_best' || 
      c.instagramUsername === 'olena_toporina'
    );
    if (debugClients.length > 0) {
      console.log('[direct/clients] 🔍 Діагностика для API:', debugClients.map(c => ({
        instagramUsername: c.instagramUsername,
        isOnlineConsultation: c.isOnlineConsultation,
        consultationBookingDate: c.consultationBookingDate,
        paidServiceDate: c.paidServiceDate,
      })));
    }

    // ВАЖЛИВО: Altegio рахує консультацію як “візит”.
    // Правило: консультацію показуємо, якщо visits = 0 або visits = 1.
    // Ігноруємо консультацію тільки коли visits >= 2.
    // - не показуємо в колонці "Запис на консультацію"
    // - не дозволяємо відкривати "Історія консультацій"
    // - не ведемо лічильник спроб консультації
    clients = clients.map((c) => {
      const hadConsult = Boolean((c as any).consultationBookingDate);
      const shouldIgnoreConsult = (c.visits ?? 0) >= 2 && !hadConsult;
      if (shouldIgnoreConsult) {
        return {
          ...c,
          consultationDate: undefined,
          consultationBookingDate: undefined,
          consultationAttended: null,
          consultationCancelled: false,
          consultationMasterId: undefined,
          consultationMasterName: undefined,
          consultationAttemptNumber: undefined,
        };
      }
      return c;
    });

    // Без direct_client_state_logs / direct_message / binotel у цьому запиті — лише поля з direct_clients + daysSinceLastVisit.
    const clientsWithStates = clients.map((client) => ({ ...client, last5States: [] as any[] }));
    const clientsWithDaysSinceLastVisit = enrichClientsWithDaysSinceLastVisitField(clientsWithStates);

    // Фільтри колонок (Act, Днів, Inst, Стан, Консультація, Запис, Майстер, Передзвонити) — Europe/Kyiv для дат
    const todayKyiv = kyivDayFromISO(new Date().toISOString());
    const currentMonthKyiv = todayKyiv.slice(0, 7);
    const startOfMonth = `${currentMonthKyiv}-01`;
    const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
    const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
    /** Дата створення запису на консультацію (fallback на consultationBookingDate для узгодженості з UI) */
    // «Консультації створені» = тільки дата створення запису (consultationRecordCreatedAt), не підставляти дату консультації (booking).
    const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
      (c as any).consultationRecordCreatedAt ?? undefined;
    const parseActYear = (y: string | null): string => {
      if (!y) return '';
      const n = parseInt(y, 10);
      if (n >= 26 && n <= 28) return `20${String(n).padStart(2, '0')}`;
      return '';
    };
    const parseMonth = (m: string | null): string => {
      if (!m) return '';
      const n = parseInt(m, 10);
      if (n >= 1 && n <= 12) return String(n).padStart(2, '0');
      return '';
    };
    const splitPipe = (s: string | null): string[] =>
      (s || '').split('|').map((x) => x.trim()).filter(Boolean);
    const splitComma = (s: string | null): string[] =>
      (s || '').split(',').map((x) => x.trim()).filter(Boolean);
    /** Перший токен (ім'я) для фільтра майстрів — об'єднання "Ім'я" та "Ім'я Прізвище". */
    const firstToken = (name: string | null | undefined): string => {
      const t = (name || '').toString().trim();
      return (t.split(/\s+/)[0] || '').trim();
    };

    let filtered = [...clientsWithDaysSinceLastVisit];

    if (actMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.updatedAt) === currentMonthKyiv || toYyyyMm((c as any).statusSetAt) === currentMonthKyiv);
    } else if (actMode === 'year_month' && actYear && actMonth) {
      const y = parseActYear(actYear);
      const m = parseMonth(actMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.updatedAt) === target || toYyyyMm((c as any).statusSetAt) === target);
      }
    }

    if (daysFilter === 'none') {
      filtered = filtered.filter((c) => typeof (c as any).daysSinceLastVisit !== 'number' || !Number.isFinite((c as any).daysSinceLastVisit));
    } else if (daysFilter === 'growing') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 0 && d < 60;
      });
    } else if (daysFilter === 'grown') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 60 && d < 90;
      });
    } else if (daysFilter === 'overgrown') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 90;
      });
    }

    const instIds = splitComma(instFilter);
    if (instIds.length > 0) {
      const set = new Set(instIds);
      filtered = filtered.filter((c) => {
        const id = (c as any).chatStatusId as string | undefined;
        return id && set.has(id);
      });
    }

    const stateIds = splitComma(stateFilter);
    if (stateIds.length > 0) {
      const set = new Set(stateIds);
      filtered = filtered.filter((c) => {
        const displayed = getDisplayedState(c);
        return displayed && set.has(displayed);
      });
    }

    // Фільтр дзвінків Binotel (по останньому дзвінку)
    const binotelDirections = splitComma(binotelCallsDirection).filter((x) =>
      ['incoming', 'outgoing'].includes(x)
    );
    const binotelOutcomes = splitComma(binotelCallsOutcome).filter((x) =>
      ['success', 'fail'].includes(x)
    );
    const phoneToClientIdsForFilter = new Map<string, string[]>();
    for (const c of clientsWithDaysSinceLastVisit) {
      const norm = normalizePhone(c.phone);
      if (!norm) continue;
      const arr = phoneToClientIdsForFilter.get(norm) ?? [];
      if (!arr.includes(c.id)) arr.push(c.id);
      phoneToClientIdsForFilter.set(norm, arr);
    }
    const hasBinotelFilter =
      (binotelDirections.length > 0 && binotelDirections.length < 2) ||
      (binotelOutcomes.length > 0 && binotelOutcomes.length < 2) ||
      binotelCallsOnlyNew;
    if (hasBinotelFilter) {
      const SUCCESS_DISP = ['ANSWER', 'VM-SUCCESS', 'SUCCESS'];
      filtered = filtered.filter((c) => {
        const count = (c as any).binotelCallsCount ?? 0;
        if (count <= 0) return false;
        if (binotelCallsOnlyNew) {
          if (c.state !== 'binotel-lead') return false;
          if (c.altegioClientId) return false;
          const norm = normalizePhone(c.phone);
          if (!norm) return false;
          const ids = phoneToClientIdsForFilter.get(norm) ?? [];
          if (ids.length !== 1 || ids[0] !== c.id) return false;
        }
        const callType = (c as any).binotelLatestCallType as string | undefined;
        const disposition = (c as any).binotelLatestCallDisposition as string | undefined;
        const isSuccess = disposition ? SUCCESS_DISP.includes(disposition) : false;
        if (binotelDirections.length === 1) {
          const match =
            (binotelDirections[0] === 'incoming' && callType === 'incoming') ||
            (binotelDirections[0] === 'outgoing' && callType === 'outgoing');
          if (!match) return false;
        }
        if (binotelOutcomes.length === 1) {
          const match =
            (binotelOutcomes[0] === 'success' && isSuccess) ||
            (binotelOutcomes[0] === 'fail' && !isSuccess);
          if (!match) return false;
        }
        return true;
      });
    }

    // Фільтри по колонках (Консультація, Запис, Майстер, Передзвонити) об'єднуються за OR: показуємо клієнтів, що підходять під будь-який із них
    // Збереження стану перед фільтрами по колонках — для clientsForBookedStats (KPI «Заплановано» показує повну картину).
    const filteredBeforeColumnFilters = [...filtered];

    const hasConsultationFilters =
      consultHasConsultation === 'true' ||
      consultCreatedMode === 'current_month' ||
      (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) ||
      consultCreatedPreset != null ||
      consultAppointedMode === 'current_month' ||
      (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) ||
      consultAppointedPreset != null ||
      consultAttendance != null ||
      consultType != null ||
      (splitPipe(consultMasters).length > 0);
    const hasRecordFilters =
      recordHasRecord === 'true' ||
      recordNewClient === 'true' ||
      recordCreatedMode === 'current_month' ||
      (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) ||
      recordCreatedPreset != null ||
      recordAppointedMode === 'current_month' ||
      (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) ||
      recordAppointedPreset != null ||
      recordClient != null ||
      recordSum != null ||
      (masterHands && [2, 4, 6].includes(parseInt(masterHands, 10)));
    const hasMasterFilters = splitPipe(masterPrimary).length > 0 || splitPipe(masterSecondary).length > 0;
    const hasCallbackReminderFilters = callbackReminderPreset != null;
    const hasColumnFilters =
      hasConsultationFilters || hasRecordFilters || hasMasterFilters || hasCallbackReminderFilters;

    if (hasColumnFilters) {
      const base = [...filtered];

      const applyConsultation = (arr: typeof base) => {
        let out = arr;
        // «Є консультація»: тільки клієнти з consultationBookingDate (активний запис, без consultationDeletedInAltegio)
        if (consultHasConsultation === 'true') {
          out = out.filter((c) => c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '');
        }
        // «Консультації створені» = дата створення запису; період як у Статистиці — з початку місяця до сьогодні.
        if (consultCreatedMode === 'current_month') {
          out = out.filter((c) => {
            const day = toKyivDay(getConsultCreatedAt(c));
            return day && day >= startOfMonth && day <= todayKyiv;
          });
        } else if (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) {
          const y = parseActYear(consultCreatedYear);
          const m = parseMonth(consultCreatedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm(getConsultCreatedAt(c)) === `${y}-${m}`);
        }
        if (consultCreatedPreset === 'past') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) && toKyivDay(getConsultCreatedAt(c))! < todayKyiv);
        } else if (consultCreatedPreset === 'today') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) === todayKyiv);
        } else if (consultCreatedPreset === 'future') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) && toKyivDay(getConsultCreatedAt(c))! > todayKyiv);
        }
        if (consultAppointedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm(c.consultationBookingDate) === currentMonthKyiv);
        } else if (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) {
          const y = parseActYear(consultAppointedYear);
          const m = parseMonth(consultAppointedMonth);
          if (y && m) {
            const target = `${y}-${m}`;
            out = out.filter((c) => toYyyyMm(c.consultationBookingDate) === target);
          }
        }
        if (consultAppointedPreset === 'past') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) && toKyivDay(c.consultationBookingDate) < todayKyiv);
        } else if (consultAppointedPreset === 'today') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv);
        } else if (consultAppointedPreset === 'future') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) && toKyivDay(c.consultationBookingDate) > todayKyiv);
        }
        if (consultAttendance === 'attended') {
          out = out.filter((c) => {
            if (c.consultationAttended !== true) return false;
            // Прийшла — для минулих дат включно з сьогодні
            const consultDay = toKyivDay(c.consultationBookingDate);
            return consultDay != null && consultDay <= todayKyiv;
          });
        } else if (consultAttendance === 'no_show') {
          out = out.filter((c) => {
            if (c.consultationAttended !== false || c.consultationCancelled) return false;
            // No-show можливий тільки для минулих дат (включно з сьогодні)
            const consultDay = toKyivDay(c.consultationBookingDate);
            return consultDay != null && consultDay <= todayKyiv;
          });
        }
        else if (consultAttendance === 'cancelled') out = out.filter((c) => !!c.consultationCancelled);
        if (consultType === 'consultation') out = out.filter((c) => !(c as any).isOnlineConsultation);
        else if (consultType === 'online') out = out.filter((c) => !!(c as any).isOnlineConsultation);
        const consultMasterListLocal = splitPipe(consultMasters);
        if (consultMasterListLocal.length > 0) {
          const norms = new Set(consultMasterListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const first = firstToken(c.consultationMasterName).toLowerCase().trim();
            return first && norms.has(first);
          });
        }
        return out;
      };

      const applyRecord = (arr: typeof base) => {
        let out = arr;
        if (recordHasRecord === 'true') {
          out = out.filter((c) => c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
        }
        if (recordNewClient === 'true') {
          out = out.filter((c) => c.consultationAttended === true && c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
        }
        if (recordCreatedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === currentMonthKyiv);
        } else if (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) {
          const y = parseActYear(recordCreatedYear);
          const m = parseMonth(recordCreatedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === `${y}-${m}`);
        }
        if (recordCreatedPreset === 'past') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) && toKyivDay((c as any).paidServiceRecordCreatedAt) < todayKyiv);
        } else if (recordCreatedPreset === 'today') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) === todayKyiv);
        } else if (recordCreatedPreset === 'future') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) && toKyivDay((c as any).paidServiceRecordCreatedAt) > todayKyiv);
        }
        if (recordAppointedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm(c.paidServiceDate) === currentMonthKyiv);
        } else if (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) {
          const y = parseActYear(recordAppointedYear);
          const m = parseMonth(recordAppointedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm(c.paidServiceDate) === `${y}-${m}`);
        }
        if (recordAppointedPreset === 'past') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) && toKyivDay(c.paidServiceDate) < todayKyiv);
        } else if (recordAppointedPreset === 'today') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) === todayKyiv);
        } else if (recordAppointedPreset === 'future') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) && toKyivDay(c.paidServiceDate) > todayKyiv);
        }
        if (recordClient === 'attended') {
          out = out.filter((c) => {
            if (c.paidServiceAttended !== true) return false;
            // Прийшла — для минулих дат включно з сьогодні
            const paidDay = toKyivDay(c.paidServiceDate);
            return paidDay != null && paidDay <= todayKyiv;
          });
        } else if (recordClient === 'no_show') {
          out = out.filter((c) => {
            if (c.paidServiceAttended !== false || c.paidServiceCancelled) return false;
            // No-show можливий тільки для минулих дат (включно з сьогодні)
            const paidDay = toKyivDay(c.paidServiceDate);
            return paidDay != null && paidDay <= todayKyiv;
          });
        }
        else if (recordClient === 'cancelled') out = out.filter((c) => !!c.paidServiceCancelled);
        else if (recordClient === 'pending') {
          out = out.filter((c) => {
            if (!c.paidServiceDate) return false;
            const d = toKyivDay(c.paidServiceDate);
            if (!d || d < todayKyiv) return false;
            return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
          });
        } else if (recordClient === 'rebook') out = out.filter((c) => !!(c as any).paidServiceIsRebooking);
        else if (recordClient === 'unknown') {
          out = out.filter((c) => {
            if (!c.paidServiceDate) return false;
            const d = toKyivDay(c.paidServiceDate);
            if (!d || d >= todayKyiv) return false;
            return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
          });
        }
        if (recordSum === 'lt_10k') out = out.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost < 10000);
        else if (recordSum === 'gt_10k') out = out.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost >= 10000);
        const handsNum = masterHands ? parseInt(masterHands, 10) : NaN;
        if (Number.isFinite(handsNum) && (handsNum === 2 || handsNum === 4 || handsNum === 6)) {
          out = out.filter((c) => (c as any).paidServiceHands === handsNum);
        }
        return out;
      };

      const applyMaster = (arr: typeof base) => {
        let out = arr;
        const primaryListLocal = splitPipe(masterPrimary);
        if (primaryListLocal.length > 0) {
          const norms = new Set(primaryListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const firstService = firstToken(c.serviceMasterName).toLowerCase().trim();
            if (firstService && norms.has(firstService)) return true;
            const mid = c.masterId ? directMasterIdToName.get(c.masterId) : null;
            return !!firstToken(mid || '').toLowerCase().trim() && norms.has(firstToken(mid || '').toLowerCase().trim());
          });
        }
        const secondaryListLocal = splitPipe(masterSecondary);
        if (secondaryListLocal.length > 0) {
          const norms = new Set(secondaryListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const first = firstToken((c as any).serviceSecondaryMasterName).toLowerCase().trim();
            return first && norms.has(first);
          });
        }
        return out;
      };

      const applyCallbackReminder = (arr: typeof base) => {
        let out = arr;
        if (callbackReminderPreset === 'past') {
          out = out.filter((c) => {
            const d = (c.callbackReminderKyivDay ?? '').toString().trim();
            return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < todayKyiv;
          });
        } else if (callbackReminderPreset === 'today') {
          out = out.filter((c) => (c.callbackReminderKyivDay ?? '').toString().trim() === todayKyiv);
        } else if (callbackReminderPreset === 'future') {
          out = out.filter((c) => {
            const d = (c.callbackReminderKyivDay ?? '').toString().trim();
            return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > todayKyiv;
          });
        }
        return out;
      };

      const consultationPart = hasConsultationFilters ? applyConsultation(base) : [];
      const recordPart = hasRecordFilters ? applyRecord(base) : [];
      const masterPart = hasMasterFilters ? applyMaster(base) : [];
      const callbackPart = hasCallbackReminderFilters ? applyCallbackReminder(base) : [];
      let resultIds: Set<string>;
      if (columnFilterMode === 'and') {
        // Взаємообмежуючі: клієнт має проходити всі активні колонкові фільтри
        resultIds = new Set(base.map((c) => c.id));
        if (hasConsultationFilters) {
          const consultIds = new Set(consultationPart.map((c) => c.id));
          resultIds = new Set([...resultIds].filter((id) => consultIds.has(id)));
        }
        if (hasRecordFilters) {
          const recIds = new Set(recordPart.map((c) => c.id));
          resultIds = new Set([...resultIds].filter((id) => recIds.has(id)));
        }
        if (hasMasterFilters) {
          const mastIds = new Set(masterPart.map((c) => c.id));
          resultIds = new Set([...resultIds].filter((id) => mastIds.has(id)));
        }
        if (hasCallbackReminderFilters) {
          const cbIds = new Set(callbackPart.map((c) => c.id));
          resultIds = new Set([...resultIds].filter((id) => cbIds.has(id)));
        }
      } else {
        // OR: клієнт підходить під будь-який із колонкових фільтрів
        resultIds = new Set<string>();
        for (const c of consultationPart) resultIds.add(c.id);
        for (const c of recordPart) resultIds.add(c.id);
        for (const c of masterPart) resultIds.add(c.id);
        for (const c of callbackPart) resultIds.add(c.id);
      }
      filtered = base.filter((c) => resultIds.has(c.id));
      // При «Прийшла» не показувати рядки без ✅: виключаємо клієнтів з майбутньою датою
      // (навіть якщо вони потрапили через Record/Master у OR-режимі)
      if (hasConsultationFilters && consultAttendance === 'attended') {
        filtered = filtered.filter((c) => {
          if (c.consultationAttended !== true) return false;
          const consultDay = toKyivDay(c.consultationBookingDate);
          return consultDay != null && consultDay <= todayKyiv;
        });
      }
    } else {
      // Жодного фільтра по колонках — застосовуємо AND-логіку нижче
    }

    if (!hasColumnFilters) {
    if (consultHasConsultation === 'true') {
      filtered = filtered.filter((c) => c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '');
    }
    // «Консультації створені» = дата створення запису; період як у Статистиці — з початку місяця до сьогодні.
    if (consultCreatedMode === 'current_month') {
      filtered = filtered.filter((c) => {
        const day = toKyivDay(getConsultCreatedAt(c));
        return day && day >= startOfMonth && day <= todayKyiv;
      });
    } else if (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) {
      const y = parseActYear(consultCreatedYear);
      const m = parseMonth(consultCreatedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(getConsultCreatedAt(c)) === target);
      }
    }

    if (consultAppointedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.consultationBookingDate) === currentMonthKyiv);
    } else if (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) {
      const y = parseActYear(consultAppointedYear);
      const m = parseMonth(consultAppointedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.consultationBookingDate) === target);
      }
    }

    if (consultAppointedPreset === 'past') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.consultationBookingDate);
        return !!d && d < todayKyiv;
      });
    } else if (consultAppointedPreset === 'today') {
      filtered = filtered.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv);
    } else if (consultAppointedPreset === 'future') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.consultationBookingDate);
        return !!d && d > todayKyiv;
      });
    }

    if (consultAttendance === 'attended') {
      filtered = filtered.filter((c) => {
        if (c.consultationAttended !== true) return false;
        // Прийшла — для минулих дат включно з сьогодні
        const consultDay = toKyivDay(c.consultationBookingDate);
        return consultDay != null && consultDay <= todayKyiv;
      });
    } else if (consultAttendance === 'no_show') {
      filtered = filtered.filter((c) => {
        if (c.consultationAttended !== false || c.consultationCancelled) return false;
        // No-show можливий тільки для минулих дат (включно з сьогодні)
        const consultDay = toKyivDay(c.consultationBookingDate);
        return consultDay != null && consultDay <= todayKyiv;
      });
    } else if (consultAttendance === 'cancelled') {
      filtered = filtered.filter((c) => !!c.consultationCancelled);
    }

    if (consultType === 'consultation') {
      filtered = filtered.filter((c) => !(c as any).isOnlineConsultation);
    } else if (consultType === 'online') {
      filtered = filtered.filter((c) => !!(c as any).isOnlineConsultation);
    }

    const consultMasterList = splitPipe(consultMasters);
    if (consultMasterList.length > 0) {
      const norms = new Set(consultMasterList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const first = firstToken(c.consultationMasterName).toLowerCase().trim();
        return first && norms.has(first);
      });
    }

    if (recordHasRecord === 'true') {
      filtered = filtered.filter((c) => c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
    }
    if (recordNewClient === 'true') {
      filtered = filtered.filter((c) => c.consultationAttended === true && c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
    }
    if (recordCreatedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === currentMonthKyiv);
    } else if (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) {
      const y = parseActYear(recordCreatedYear);
      const m = parseMonth(recordCreatedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === target);
      }
    }

    if (recordAppointedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.paidServiceDate) === currentMonthKyiv);
    } else if (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) {
      const y = parseActYear(recordAppointedYear);
      const m = parseMonth(recordAppointedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.paidServiceDate) === target);
      }
    }

    if (recordAppointedPreset === 'past') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.paidServiceDate);
        return !!d && d < todayKyiv;
      });
    } else if (recordAppointedPreset === 'today') {
      filtered = filtered.filter((c) => toKyivDay(c.paidServiceDate) === todayKyiv);
    } else if (recordAppointedPreset === 'future') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.paidServiceDate);
        return !!d && d > todayKyiv;
      });
    }

    if (recordClient === 'attended') {
      filtered = filtered.filter((c) => {
        if (c.paidServiceAttended !== true) return false;
        // Прийшла — для минулих дат включно з сьогодні
        const paidDay = toKyivDay(c.paidServiceDate);
        return paidDay != null && paidDay <= todayKyiv;
      });
    } else if (recordClient === 'no_show') {
      filtered = filtered.filter((c) => {
        if (c.paidServiceAttended !== false || c.paidServiceCancelled) return false;
        // No-show можливий тільки для минулих дат (включно з сьогодні)
        const paidDay = toKyivDay(c.paidServiceDate);
        return paidDay != null && paidDay <= todayKyiv;
      });
    } else if (recordClient === 'cancelled') {
      filtered = filtered.filter((c) => !!c.paidServiceCancelled);
    } else if (recordClient === 'pending') {
      filtered = filtered.filter((c) => {
        if (!c.paidServiceDate) return false;
        const d = toKyivDay(c.paidServiceDate);
        if (!d || d < todayKyiv) return false;
        return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
      });
    } else if (recordClient === 'rebook') {
      filtered = filtered.filter((c) => !!(c as any).paidServiceIsRebooking);
    } else if (recordClient === 'unknown') {
      filtered = filtered.filter((c) => {
        if (!c.paidServiceDate) return false;
        const d = toKyivDay(c.paidServiceDate);
        if (!d || d >= todayKyiv) return false;
        return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
      });
    }

    if (recordSum === 'lt_10k') {
      filtered = filtered.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost < 10000);
    } else if (recordSum === 'gt_10k') {
      filtered = filtered.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost >= 10000);
    }

    const handsNum = masterHands ? parseInt(masterHands, 10) : NaN;
    if (Number.isFinite(handsNum) && (handsNum === 2 || handsNum === 4 || handsNum === 6)) {
      filtered = filtered.filter((c) => (c as any).paidServiceHands === handsNum);
    }

    const primaryList = splitPipe(masterPrimary);
    if (primaryList.length > 0) {
      const norms = new Set(primaryList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const firstService = firstToken(c.serviceMasterName).toLowerCase().trim();
        if (firstService && norms.has(firstService)) return true;
        const mid = c.masterId ? directMasterIdToName.get(c.masterId) : null;
        const firstResp = firstToken(mid || '').toLowerCase().trim();
        return !!firstResp && norms.has(firstResp);
      });
    }

    const secondaryList = splitPipe(masterSecondary);
    if (secondaryList.length > 0) {
      const norms = new Set(secondaryList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const first = firstToken((c as any).serviceSecondaryMasterName).toLowerCase().trim();
        return first && norms.has(first);
      });
    }
    }

    // Глобальні лічильники статусів для панелі фільтрів (вся БД; не залежать від пошуку/колонок). Рядки таблиці — filtered нижче.
    const statusCounts = globalStatusCountsForFilters;

    // Фільтр за статусом — застосовуємо в кінці, щоб фільтрувати всю базу
    if (statusIds.length > 0) {
      const statusIdsSet = new Set(statusIds);
      filtered = filtered.filter((c) => c.statusId && statusIdsSet.has(c.statusId));
    } else if (statusId) {
      filtered = filtered.filter((c) => c.statusId === statusId);
    }

    // Сортування після обчислення daysSinceLastVisit і messagesTotal
    // Коли активний фільтр Днів — спочатку sort by daysSinceLastVisit desc (найбільш «відрослі» зверху)
    const sortByDaysWhenDaysFilterActive = daysFilter && sortBy !== 'daysSinceLastVisit';
    // Активний режим (updatedAt desc): спочатку клієнти «сьогодні» — щоб перші 50 завжди включали блок сьогоднішніх
    const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
    const todayKyivSort = isActiveMode ? kyivDayFromISO(new Date().toISOString()) : '';
    const hasTriggerSort = (c: any): boolean => {
      if (!todayKyivSort) return false;
      const mainDate = c.updatedAt ?? c.createdAt;
      if (mainDate && isKyivCalendarDayEqualToReference(String(mainDate), todayKyivSort)) return true;
      if (c.lastMessageAt && isKyivCalendarDayEqualToReference(String(c.lastMessageAt), todayKyivSort)) return true;
      if (isKyivCalendarDayEqualToReference(c.consultationBookingDate, todayKyivSort)) return true;
      if (isKyivCalendarDayEqualToReference(c.paidServiceDate, todayKyivSort)) return true;
      if (isKyivCalendarDayEqualToReference(c.statusSetAt, todayKyivSort)) return true;
      if ((c.callbackReminderKyivDay || '').toString().trim() === todayKyivSort) return true;
      return false;
    };
    filtered.sort((a, b) => {
      if (sortByDaysWhenDaysFilterActive) {
        const da = typeof (a as any).daysSinceLastVisit === 'number' && Number.isFinite((a as any).daysSinceLastVisit) ? (a as any).daysSinceLastVisit : -1;
        const db = typeof (b as any).daysSinceLastVisit === 'number' && Number.isFinite((b as any).daysSinceLastVisit) ? (b as any).daysSinceLastVisit : -1;
        if (db !== da) return db - da; // desc: більше днів спочатку
      }
      // Активний режим: тригери (сьогодні) спочатку
      if (isActiveMode) {
        const aT = hasTriggerSort(a);
        const bT = hasTriggerSort(b);
        if (aT !== bT) return aT ? -1 : 1;
      }
      let aVal: any = (a as any)[sortBy];
      let bVal: any = (b as any)[sortBy];

      if (sortBy === 'statusId') {
        aVal = statusMap.get(a.statusId) || '';
        bVal = statusMap.get(b.statusId) || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      } else if (sortBy === 'masterId') {
        aVal = a.serviceMasterName || '';
        bVal = b.serviceMasterName || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      } else if (sortBy === 'daysSinceLastVisit') {
        aVal = typeof (a as any).daysSinceLastVisit === 'number' && Number.isFinite((a as any).daysSinceLastVisit) ? (a as any).daysSinceLastVisit : -1;
        bVal = typeof (b as any).daysSinceLastVisit === 'number' && Number.isFinite((b as any).daysSinceLastVisit) ? (b as any).daysSinceLastVisit : -1;
      } else if (sortBy === 'messagesTotal') {
        aVal = typeof (a as any).messagesTotal === 'number' && Number.isFinite((a as any).messagesTotal) ? (a as any).messagesTotal : 0;
        bVal = typeof (b as any).messagesTotal === 'number' && Number.isFinite((b as any).messagesTotal) ? (b as any).messagesTotal : 0;
      } else if (sortBy === 'updatedAt') {
        // Активне сортування: використовуємо max(updatedAt, lastMessageAt), щоб клієнти з новим повідомленням піднімались вгору
        const toTs = (c: any): number => {
          const u = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
          const m = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
          return Math.max(Number.isFinite(u) ? u : 0, Number.isFinite(m) ? m : 0);
        };
        aVal = toTs(a);
        bVal = toTs(b);
      } else if (sortBy.includes('Date') || sortBy === 'firstContactDate' || sortBy === 'consultationDate' || sortBy === 'visitDate' || sortBy === 'paidServiceDate' || sortBy === 'consultationBookingDate' || sortBy === 'createdAt') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      } else if (sortBy === 'visitedSalon' || sortBy === 'signedUpForPaidService' || sortBy === 'consultationAttended' || sortBy === 'signedUpForPaidServiceAfterConsultation') {
        aVal = aVal ? 1 : 0;
        bVal = bVal ? 1 : 0;
      } else if (typeof aVal === 'string' || typeof bVal === 'string') {
        aVal = (aVal ?? '').toString().toLowerCase();
        bVal = (bVal ?? '').toString().toLowerCase();
      } else {
        aVal = aVal ?? '';
        bVal = bVal ?? '';
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    // Активна база: limit/offset — повертаємо тільки зріз (totalCount = повна кількість після фільтрів)
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const parsedLimit = limitParam != null ? parseInt(limitParam, 10) : 0;
    const parsedOffset = offsetParam != null ? parseInt(offsetParam, 10) : 0;
    const sliceLimit = parsedLimit > 0 ? Math.min(200, parsedLimit) : 0;
    const sliceStart = sliceLimit > 0 ? Math.max(0, parsedOffset || 0) : 0;
    const totalFilteredCount = filtered.length;
    const clientsToReturn = sliceLimit > 0 ? filtered.slice(sliceStart, sliceStart + sliceLimit) : filtered;
    console.log(`[direct/clients] GET: Returning ${clientsToReturn.length} clients (total filtered: ${totalFilteredCount})${sliceLimit > 0 ? ` [limit=${sliceLimit}, offset=${sliceStart}]` : ''}`);

    // Статистика незалежна від фільтрів: рядок «Заплановано» показує повну картину поточного місяця.
    // clientsForBookedStats = усі з консультацією в місяці (збігається з фільтром: Минулі 13, Сьогодні 5, Майбутні 4).
    // day param: для історії звітів (сторінка Статистика) — період past/today/future відносно обраної дати.
    if (statsOnly) {
      const cacheKey = getStatsCacheKey(searchParams);
      const cached = statsOnlyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json(cached.payload, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            'X-Direct-Stats-Cache': 'HIT',
          },
        });
      }
      const dayParam = searchParams.get('day') || '';
      const todayKyivForStats = getTodayKyiv(dayParam);
      const statsMonthKey = todayKyivForStats.slice(0, 7);
      const statsStartOfMonth = `${statsMonthKey}-01`;
      const monthEnd = (() => {
        const [y, m] = statsMonthKey.split('-');
        const lastDay = new Date(Number(y), Number(m), 0).getDate();
        return `${statsMonthKey}-${String(lastDay).padStart(2, '0')}`;
      })();
      const sourceForBooked = statsFullPicture && clientsForBookedStatsBase.length > 0 ? clientsForBookedStatsBase : clientsWithDaysSinceLastVisit;
      const clientsForBookedStats = sourceForBooked.filter((c) => {
        const d = toKyivDay(c.consultationBookingDate);
        return !!d && d >= statsStartOfMonth && d <= monthEnd;
      });
      // KPI не залежить від фільтрів колонок: використовуємо filteredBeforeColumnFilters для повної картини
      const clientsForStats = statsFullPicture ? filteredBeforeColumnFilters : filtered;
      const periodStats = computePeriodStats(clientsForStats, { clientsForBookedStats, todayKyiv: todayKyivForStats });
      const newLeadsFromCompute = (periodStats.today as any).newLeadsCount ?? 0;
      // Нові ліди: як Direct-фільтр — toKyivDay (Europe/Kyiv). UTC-межі через getKyivDayUtcBounds.
      try {
        const { startUtc: todayStart, endUtc: todayEnd } = getKyivDayUtcBounds(todayKyivForStats);
        const { startUtc: monthStart } = getKyivDayUtcBounds(statsStartOfMonth);
        const [dbToday, dbPast] = await Promise.all([
          prisma.directClient.count({
            where: { firstContactDate: { gte: todayStart, lt: todayEnd } },
          }),
          prisma.directClient.count({
            where: { firstContactDate: { gte: monthStart, lt: todayStart } },
          }),
        ]);
        (periodStats.today as any).newLeadsCount = dbToday;
        periodStats.past.newLeadsCount = dbPast;
      } catch (err) {
        console.warn('[direct/clients] statsOnly: помилка newLeadsCount з БД:', err);
      }
      // Відновлено консультацій: з direct_client_state_logs (як у periods API)
      try {
        const res = await prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::int as count FROM "direct_client_state_logs"
          WHERE state = 'consultation-rescheduled'
          AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyivForStats}::date
        `;
        (periodStats.today as any).consultationRescheduledCount = Number(res[0]?.count ?? 0);
      } catch (err) {
        console.warn('[direct/clients] statsOnly: помилка consultationRescheduledCount:', err);
      }
      console.log('[direct/clients] statsOnly KPI Заплановано:', {
        clientsForBookedStatsCount: clientsForBookedStats.length,
        consultationBookedToday: (periodStats.today as any).consultationBookedToday,
        consultationPlannedFuture: periodStats.future.consultationPlannedFuture,
      });
      const payload = {
        ok: true,
        totalCount: filtered.length,
        periodStats,
      };
      statsOnlyCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + STATS_CACHE_TTL_MS,
      });
      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'X-Direct-Stats-Cache': 'MISS',
        },
      });
    }
    
    const debugBreakdown = searchParams.get('debugBreakdown') === '1';
    const breakdownSample = debugBreakdown
      ? filtered
          .filter((c) => Array.isArray(c.paidServiceVisitBreakdown) && c.paidServiceVisitBreakdown.length > 0)
          .slice(0, 20)
          .map((c) => {
            const bd = c.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[];
            const totalFromBd = bd.reduce((a, x) => a + x.sumUAH, 0);
            return {
              instagram: c.instagramUsername,
              firstName: c.firstName,
              lastName: c.lastName,
              paidServiceTotalCost: c.paidServiceTotalCost,
              totalFromBreakdown: totalFromBd,
              mismatch: typeof c.paidServiceTotalCost === 'number' && Math.abs(totalFromBd - c.paidServiceTotalCost) > 1000,
              breakdown: bd,
            };
          })
      : undefined;

    let globalColumnFilterAgg = emptyGlobalColumnFilterAggregates();
    let masterFilterPanelCountsHeavy = emptyGlobalMasterFilterPanelCounts();
    let binotelCallsFilterCountsHeavy = {
      incoming: 0,
      outgoing: 0,
      success: 0,
      fail: 0,
      onlyNew: 0,
    };
    if (!skipPanelCounts) {
      globalColumnFilterAgg = computeGlobalColumnFilterAggregatesFromClients(clientsFullForGlobalCounts);
      masterFilterPanelCountsHeavy = buildGlobalMasterFilterPanelCounts(
        clientsFullForGlobalCounts,
        mastersForGlobalFilterPanel
      );
      binotelCallsFilterCountsHeavy = await computeBinotelCallsFilterCountsFromDb();
    } else {
      console.log('[direct/clients] heavy: skipPanelCounts=1 — без повного обходу для лічильників колонок / Binotel у цій відповіді');
    }

    const response: Record<string, unknown> = {
      ok: true,
      clients: clientsToReturn,
      totalCount: totalFilteredCount, // Кількість після фільтрів (для пагінації / infinite scroll)
      statusCounts, // Кількість по статусах з усієї бази (для фільтра)
      daysCounts: globalColumnFilterAgg.daysCounts,
      stateCounts: globalColumnFilterAgg.stateCounts,
      instCounts: globalColumnFilterAgg.instCounts,
      clientTypeCounts: globalColumnFilterAgg.clientTypeCounts,
      consultationCounts: globalColumnFilterAgg.consultationCounts,
      recordCounts: globalColumnFilterAgg.recordCounts,
      binotelCallsFilterCounts: binotelCallsFilterCountsHeavy,
      masterFilterPanelCounts: masterFilterPanelCountsHeavy,
      debug: {
        totalBeforeFilter: clients.length,
        filters: { statusId, masterId, source },
        sortBy,
        sortOrder,
        simplified: true,
        ...(breakdownSample && { breakdownSample }),
      },
    };
    console.log('[direct/clients] GET: Response summary:', {
      ok: response.ok,
      clientsCount: Array.isArray(response.clients) ? response.clients.length : 0,
      filters: (response.debug as { filters?: unknown })?.filters,
    });
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[direct/clients] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST - створити нового клієнта
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      instagramUsername,
      firstName,
      lastName,
      source = 'instagram',
      statusId,
      masterId,
      consultationDate,
      comment,
    } = body;

    if (!instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'Instagram username is required' },
        { status: 400 }
      );
    }

    // Перевіряємо, чи не існує вже клієнт з таким username
    const existing = await getAllDirectClients({
      kyivDayColumnsExist: await directKyivDayColumnsExist(),
    });
    const duplicate = existing.find(
      (c) => c.instagramUsername.toLowerCase() === instagramUsername.toLowerCase()
    );
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: 'Client with this Instagram username already exists', clientId: duplicate.id },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const client: DirectClient = {
      id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      instagramUsername: instagramUsername.trim(),
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      source: source as 'instagram' | 'tiktok' | 'other',
      firstContactDate: now,
      statusId: statusId || 'lead', // За замовчуванням: лід (клієнт — якщо є altegioClientId, задає форма)
      masterId: masterId,
      consultationDate: consultationDate,
      visitedSalon: false,
      signedUpForPaidService: false,
      signupAdmin: undefined,
      comment: comment?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    await saveDirectClient(client, 'direct-clients-post', { source: 'ui' }, { touchUpdatedAt: false });

    return NextResponse.json({ ok: true, client });
  } catch (error) {
    console.error('[direct/clients] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}