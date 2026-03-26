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
} from '@/lib/direct-store';
import { getMasters } from '@/lib/photo-reports/service';
import { getLast5StatesForClients } from '@/lib/direct-state-log';
import type { DirectClient } from '@/lib/direct-types';
import { kvRead } from '@/lib/kv';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDisplayedState } from '@/lib/direct-displayed-state';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  computeServicesTotalCostUAH,
  computeGroupTotalCostUAH,
  pickNonAdminStaffFromGroup,
  pickNonAdminStaffPairFromGroup,
  countNonAdminStaffInGroup,
  pickRecordCreatedAtISOFromGroup,
  getMainVisitIdFromGroup,
  getPerMasterSumsFromGroup,
} from '@/lib/altegio/records-grouping';
import { getClientRecords, isConsultationService } from '@/lib/altegio/records';
import { computePeriodStats } from '@/lib/direct-period-stats';
import { getTodayKyiv, getKyivDayUtcBounds } from '@/lib/direct-stats-config';
import { fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';
import { normalizePhone } from '@/lib/binotel/normalize-phone';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
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
 * Метадані колонки «Переписка» (Inst): messagesTotal, chatNeedsAttention, chatStatusName, ефективне lastMessageAt.
 * Heavy-шлях і lightweight (сторінка) використовують ту саму логіку, щоб Inst не був порожнім при lightweight=1.
 */
async function enrichClientsWithChatMeta<T extends { id: string }>(clients: T[]): Promise<T[]> {
  try {
    const ids = clients.map((c) => c.id);
    if (!ids.length) return clients;

    const [totalCounts, lastIncoming, firstIncoming] = await Promise.all([
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, direction: 'incoming' },
        _max: { receivedAt: true },
      }),
      prisma.directMessage.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, direction: 'incoming' },
        _min: { receivedAt: true },
      }),
    ]);

    const totalMap = new Map<string, number>();
    for (const r of totalCounts) {
      totalMap.set(r.clientId, (r as any)?._count?._all ?? 0);
    }

    const lastIncomingMap = new Map<string, Date>();
    for (const r of lastIncoming) {
      const dt = (r as any)?._max?.receivedAt as Date | null | undefined;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        lastIncomingMap.set(r.clientId, dt);
      }
    }

    const firstMessageReceivedAtMap = new Map<string, string>();
    for (const r of firstIncoming) {
      const dt = (r as any)?._min?.receivedAt as Date | null | undefined;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        firstMessageReceivedAtMap.set(r.clientId, dt.toISOString());
      }
    }

    const statusIds = Array.from(
      new Set(
        clients
          .map((c) => (c as any).chatStatusId)
          .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      )
    );

    const statuses =
      statusIds.length > 0
        ? await prisma.directChatStatus.findMany({
            where: { id: { in: statusIds } },
            select: { id: true, name: true, badgeKey: true, isActive: true },
          })
        : [];
    const statusMap = new Map<string, { name: string; badgeKey: string; isActive: boolean }>();
    for (const s of statuses) statusMap.set(s.id, { name: s.name, badgeKey: (s as any).badgeKey || 'badge_1', isActive: s.isActive });

    return clients.map((c) => {
      const messagesTotal = totalMap.get(c.id) ?? 0;
      const lastIn = lastIncomingMap.get(c.id) ?? null;

      const stId = ((c as any).chatStatusId || '').toString().trim() || '';
      const st = stId ? statusMap.get(stId) : null;

      const checkedAtIso = (c as any).chatStatusCheckedAt as string | undefined;
      const setAtIso = (c as any).chatStatusSetAt as string | undefined;
      const thresholdIso = (checkedAtIso || setAtIso || '').toString().trim();
      const thresholdTs = thresholdIso ? new Date(thresholdIso).getTime() : NaN;

      const chatNeedsAttention = (() => {
        if (!lastIn) return false;
        if (Number.isFinite(thresholdTs)) return lastIn.getTime() > thresholdTs;
        const hasStatus = Boolean(stId);
        return !hasStatus;
      })();

      const firstMessageReceivedAt = firstMessageReceivedAtMap.get(c.id);

      const dbLastDate = (c as any).lastMessageAt ? new Date((c as any).lastMessageAt) : null;
      const maxDate =
        !dbLastDate && !lastIn
          ? null
          : !dbLastDate
            ? lastIn
            : !lastIn
              ? dbLastDate
              : dbLastDate.getTime() >= lastIn.getTime()
                ? dbLastDate
                : lastIn;
      const effectiveLastMessageAt = maxDate ? maxDate.toISOString() : undefined;

      return {
        ...c,
        messagesTotal,
        chatNeedsAttention,
        chatStatusName: st?.name || undefined,
        chatStatusBadgeKey: st?.badgeKey || undefined,
        ...(firstMessageReceivedAt && { firstMessageReceivedAt }),
        lastMessageAt: effectiveLastMessageAt ?? (c as any).lastMessageAt,
      } as T;
    });
  } catch (err) {
    console.warn('[direct/clients] ⚠️ Не вдалося додати метадані переписки (не критично):', err);
    return clients;
  }
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
    const q = params.searchQuery;
    where.OR = [
      { instagramUsername: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ];
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

  try {
    const { searchParams } = req.nextUrl;
    const totalOnly = searchParams.get('totalOnly') === '1';
    const statsOnly = searchParams.get('statsOnly') === '1';
    const lightweight = searchParams.get('lightweight') === '1';
    const statsFullPicture = searchParams.get('statsFullPicture') === '1';
    const filterCountsOnly = searchParams.get('filterCountsOnly') === '1';
    const statusId = searchParams.get('statusId');
    const statusIdsRaw = searchParams.get('statusIds');
    const statusIds = statusIdsRaw ? (statusIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)) : [];
    const masterId = searchParams.get('masterId');
    const source = searchParams.get('source');
    const hasAppointment = searchParams.get('hasAppointment');
    const actMode = searchParams.get('actMode');
    const actYear = searchParams.get('actYear');
    const actMonth = searchParams.get('actMonth');
    const daysFilter = searchParams.get('days');
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
      Boolean(clientTypeParam);
    const canForcePagedSql = hasPageParams && !heavyOnlyColumnFiltersActive;
    // lightweight=1 інакше ігнорував би Act та інші колонкові фільтри (buildLightweightWhere їх не містить).
    if (lightweight && heavyOnlyColumnFiltersActive) {
      console.log('[direct/clients] lightweight пропущено: є фільтри лише для heavy path (actMode, state, days…)');
    }
    if ((lightweight || canForcePagedSql) && !heavyOnlyColumnFiltersActive && !statsOnly && !filterCountsOnly) {
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

        const [rows, totalCountDb, statusRows] = await withDirectClientsDbRetries(
          'lightweight-prisma',
          () =>
            Promise.all([
              prisma.directClient.findMany({ where, orderBy, skip, take }),
              prisma.directClient.count({ where }),
              prisma.directClient.groupBy({
                by: ['statusId'],
                _count: { id: true },
                // statusId у schema — обов'язковий String; { not: null } дає PrismaClientValidationError і змушує fallback на heavy.
                where,
              }),
            ])
        );

        const statusCounts: Record<string, number> = {};
        for (const r of statusRows) {
          const sid = (r.statusId || '').toString().trim();
          if (sid) statusCounts[sid] = Number(r._count.id || 0);
        }

        const serializedLight = rows.map((row) => toSerializableDirectClient(row as any));
        const clientsLight = await enrichClientsWithChatMeta(serializedLight);

        return NextResponse.json(
          {
            ok: true,
            lightweight: true,
            clients: clientsLight,
            totalCount: totalCountDb,
            statusCounts,
            debug: { mode: canForcePagedSql ? 'lightweight-forced' : 'lightweight', take, skip },
          },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              Pragma: 'no-cache',
            },
          }
        );
      } catch (lightweightErr) {
        console.error('[direct/clients] lightweight mode failed, fallback to heavy path:', lightweightErr);
        // Той самий Prisma/пул: після невдалого lightweight повторний getAllDirectClients лише дублює ретраї та затримку.
        if (isTransientDirectDbFailure(lightweightErr)) {
          return NextResponse.json(
            {
              ok: false,
              retryable: true,
              error:
                'Тимчасовий збій бази даних. Спробуйте «Оновити» через хвилину. (Швидкий запит уже не вдався; повторний повний обхід вимкнено.)',
              debug: { source: 'lightweight-transient-skip-heavy' },
            },
            { status: 503 }
          );
        }
      }
    }

    console.log('[direct/clients] GET: Fetching all clients...');
    let clients: DirectClient[] = [];
    let totalCount = 0;
    let mainFilterCounts: {
      stateCounts: Record<string, number>;
      daysCounts: { none: number; growing: number; grown: number; overgrown: number };
      binotelCallsFilterCounts?: { incoming: number; outgoing: number; success: number; fail: number };
      instCounts: Record<string, number>;
      clientTypeCounts: { leads: number; clients: number; consulted: number; good: number; stars: number };
      consultationCounts: Record<string, number>;
      recordCounts: Record<string, number>;
    } | null = null;
    try {
      clients = await getAllDirectClients();
      console.log(`[direct/clients] GET: Retrieved ${clients.length} clients from getAllDirectClients()`);
      // Те саме джерело для обох екранів: totalCount = довжина списку getAllDirectClients().
      totalCount = clients.length;

      // Пошук по імені, прізвищу, Instagram, телефону
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        clients = clients.filter((c: DirectClient) => {
          const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
          const inst = (c.instagramUsername || '').toLowerCase();
          const phone = (c.phone || '').replace(/\D/g, '');
          return (
            fullName.includes(q) ||
            (c.firstName && c.firstName.toLowerCase().includes(q)) ||
            (c.lastName && c.lastName.toLowerCase().includes(q)) ||
            inst.includes(q) ||
            (qDigits.length >= 2 && phone.includes(qDigits))
          );
        });
        totalCount = clients.length;
        console.log(`[direct/clients] GET: Після пошуку "${searchQuery}": ${clients.length} клієнтів`);
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
            return NextResponse.json({ ok: true, daysCounts: { none: 0, growing: 0, grown: 0, overgrown: 0 }, totalCount: 0 });
          }
          const daysCounts = { none: 0, growing: 0, grown: 0, overgrown: 0 };
          for (const c of clients) {
            const iso = getLastAttendedVisitDate(c);
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
          const todayKyivDay = kyivDayFromISO(new Date().toISOString());
          const currentMonthKyiv = todayKyivDay.slice(0, 7);
          const toDayIndex = (day: string): number => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
            if (!m) return NaN;
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const d = Number(m[3]);
            if (!y || !mo || !d) return NaN;
            return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
          };
          const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
          const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
          const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
            (c as any).consultationRecordCreatedAt ?? undefined;
          const todayIdx = toDayIndex(todayKyivDay);

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
          const daysCounts = { none: 0, growing: 0, grown: 0, overgrown: 0 };
          const stateCounts: Record<string, number> = {};
          const instCounts: Record<string, number> = {};
          let clientTypeLeads = 0;
          let clientTypeClients = 0;
          let clientTypeConsulted = 0;
          let clientTypeGood = 0;
          let clientTypeStars = 0;
          let consultationHasConsultation = 0;
          let consultationCreatedCur = 0;
          let consultationCreatedToday = 0;
          let consultationAppointedCur = 0;
          let consultationAppointedPast = 0;
          let consultationAppointedToday = 0;
          let consultationAppointedFuture = 0;
          let recordHasRecord = 0;
          let recordNewClient = 0;
          let recordCreatedCur = 0;
          let recordCreatedToday = 0;
          let recordAppointedCur = 0;
          let recordAppointedPast = 0;
          let recordAppointedToday = 0;
          let recordAppointedFuture = 0;

          for (const c of clients) {
            const iso = getLastAttendedVisitDate(c);
            if (!iso) daysCounts.none++;
            else {
              const day = kyivDayFromISO(iso);
              const idx = toDayIndex(day);
              if (!Number.isFinite(idx)) daysCounts.none++;
              else {
                const diff = todayIdx - idx;
                const d = diff < 0 ? 0 : diff;
                if (d >= 90) daysCounts.overgrown++;
                else if (d >= 60) daysCounts.grown++;
                else if (d >= 0) daysCounts.growing++;
                else daysCounts.none++;
              }
            }
            const state = getDisplayedState(c);
            if (state) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
            const chatId = (c as any).chatStatusId as string | undefined;
            if (chatId && chatId.trim()) instCounts[chatId] = (instCounts[chatId] ?? 0) + 1;
            if (!c.altegioClientId) clientTypeLeads++;
            else {
              clientTypeClients++;
              if ((c.spent ?? 0) === 0) clientTypeConsulted++;
            }
            const spent = c.spent ?? 0;
            if (spent >= 100000) clientTypeStars++;
            else if (spent > 0) clientTypeGood++;
            if (c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '') consultationHasConsultation++;
            const consultCreatedAt = getConsultCreatedAt(c);
            if (consultCreatedAt) {
              const m = toYyyyMm(consultCreatedAt);
              if (m === currentMonthKyiv) consultationCreatedCur++;
              if (toKyivDay(consultCreatedAt) === todayKyivDay) consultationCreatedToday++;
            }
            if (c.consultationBookingDate) {
              const m = toYyyyMm(c.consultationBookingDate);
              if (m === currentMonthKyiv) consultationAppointedCur++;
              const day = toKyivDay(c.consultationBookingDate);
              if (day && day < todayKyivDay) consultationAppointedPast++;
              else if (day === todayKyivDay) consultationAppointedToday++;
              else if (day && day > todayKyivDay) consultationAppointedFuture++;
            }
            if (c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '') {
              recordHasRecord++;
              if (c.consultationAttended === true) recordNewClient++;
              const recCreated = (c as any).paidServiceRecordCreatedAt;
              if (recCreated) {
                const recIso = typeof recCreated === 'string' ? recCreated : (recCreated as Date)?.toISOString?.();
                if (recIso && toYyyyMm(recIso) === currentMonthKyiv) recordCreatedCur++;
                if (recIso && toKyivDay(recIso) === todayKyivDay) recordCreatedToday++;
              }
              const paidDay = toKyivDay(c.paidServiceDate);
              if (paidDay) {
                if (toYyyyMm(c.paidServiceDate) === currentMonthKyiv) recordAppointedCur++;
                if (paidDay < todayKyivDay) recordAppointedPast++;
                else if (paidDay === todayKyivDay) recordAppointedToday++;
                else recordAppointedFuture++;
              }
            }
          }

          let binotelCallsFilterCounts = { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 };
          try {
            const binotelRows = await prisma.$queryRaw<
              Array<{ incoming: number; outgoing: number; success: number; fail: number }>
            >`
              WITH ranked AS (
                SELECT "clientId", "callType", disposition,
                  ROW_NUMBER() OVER (PARTITION BY "clientId" ORDER BY "startTime" DESC) AS rn
                FROM direct_client_binotel_calls
                WHERE "clientId" IS NOT NULL
              )
              SELECT
                COALESCE(SUM(CASE WHEN "callType" = 'incoming' THEN 1 ELSE 0 END), 0)::int AS incoming,
                COALESCE(SUM(CASE WHEN "callType" = 'outgoing' THEN 1 ELSE 0 END), 0)::int AS outgoing,
                COALESCE(SUM(CASE WHEN disposition IN ('ANSWER','VM-SUCCESS','SUCCESS') THEN 1 ELSE 0 END), 0)::int AS success,
                COALESCE(SUM(CASE WHEN disposition NOT IN ('ANSWER','VM-SUCCESS','SUCCESS') THEN 1 ELSE 0 END), 0)::int AS fail
              FROM ranked
              WHERE rn = 1
            `;
            if (binotelRows[0]) binotelCallsFilterCounts = { ...binotelRows[0], onlyNew: 0 };
            const phoneToClientIds = new Map<string, string[]>();
            for (const c of clients) {
              const norm = normalizePhone(c.phone);
              if (!norm) continue;
              const arr = phoneToClientIds.get(norm) ?? [];
              if (!arr.includes(c.id)) arr.push(c.id);
              phoneToClientIds.set(norm, arr);
            }
            for (const c of clients) {
              if (c.state !== 'binotel-lead' || c.altegioClientId) continue;
              const norm = normalizePhone(c.phone);
              if (!norm) continue;
              const ids = phoneToClientIds.get(norm) ?? [];
              if (ids.length === 1 && ids[0] === c.id) binotelCallsFilterCounts.onlyNew++;
            }
          } catch (binErr) {
            console.warn('[direct/clients] filterCountsOnly binotelCallsFilterCounts failed:', binErr);
          }

          return NextResponse.json({
            ok: true,
            statusCounts,
            daysCounts,
            stateCounts,
            instCounts,
            binotelCallsFilterCounts,
            clientTypeCounts: { leads: clientTypeLeads, clients: clientTypeClients, consulted: clientTypeConsulted, good: clientTypeGood, stars: clientTypeStars },
            consultationCounts: {
              hasConsultation: consultationHasConsultation,
              createdCur: consultationCreatedCur,
              createdToday: consultationCreatedToday,
              appointedCur: consultationAppointedCur,
              appointedPast: consultationAppointedPast,
              appointedToday: consultationAppointedToday,
              appointedFuture: consultationAppointedFuture,
            },
            recordCounts: {
              hasRecord: recordHasRecord,
              newClient: recordNewClient,
              createdCur: recordCreatedCur,
              createdToday: recordCreatedToday,
              appointedCur: recordAppointedCur,
              appointedPast: recordAppointedPast,
              appointedToday: recordAppointedToday,
              appointedFuture: recordAppointedFuture,
            },
            totalCount: clients.length,
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
            totalCount: 0,
          });
        }
      }

      // Обчислюємо filter counts з повного списку (до фільтрації) — один запит, counts завжди в відповіді
      if (clients.length > 0) {
        try {
          const todayKyivDay = kyivDayFromISO(new Date().toISOString());
          const currentMonthKyiv = todayKyivDay.slice(0, 7);
          const toDayIndex = (day: string): number => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
            if (!m) return NaN;
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const d = Number(m[3]);
            if (!y || !mo || !d) return NaN;
            return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
          };
          const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
          const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
          const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
            (c as any).consultationRecordCreatedAt ?? undefined;
          const todayIdx = toDayIndex(todayKyivDay);

          const daysCounts = { none: 0, growing: 0, grown: 0, overgrown: 0 };
          const stateCounts: Record<string, number> = {};
          const instCounts: Record<string, number> = {};
          let clientTypeLeads = 0;
          let clientTypeClients = 0;
          let clientTypeConsulted = 0;
          let clientTypeGood = 0;
          let clientTypeStars = 0;
          let consultationHasConsultation = 0;
          let consultationCreatedCur = 0;
          let consultationCreatedToday = 0;
          let consultationAppointedCur = 0;
          let consultationAppointedPast = 0;
          let consultationAppointedToday = 0;
          let consultationAppointedFuture = 0;
          let recordHasRecord = 0;
          let recordNewClient = 0;
          let recordCreatedCur = 0;
          let recordCreatedToday = 0;
          let recordAppointedCur = 0;
          let recordAppointedPast = 0;
          let recordAppointedToday = 0;
          let recordAppointedFuture = 0;

          for (const c of clients) {
            const iso = getLastAttendedVisitDate(c);
            if (!iso) daysCounts.none++;
            else {
              const day = kyivDayFromISO(iso);
              const idx = toDayIndex(day);
              if (!Number.isFinite(idx)) daysCounts.none++;
              else {
                const diff = todayIdx - idx;
                const d = diff < 0 ? 0 : diff;
                if (d >= 90) daysCounts.overgrown++;
                else if (d >= 60) daysCounts.grown++;
                else if (d >= 0) daysCounts.growing++;
                else daysCounts.none++;
              }
            }
            const state = getDisplayedState(c);
            if (state) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
            const chatId = (c as any).chatStatusId as string | undefined;
            if (chatId && chatId.trim()) instCounts[chatId] = (instCounts[chatId] ?? 0) + 1;
            if (!c.altegioClientId) clientTypeLeads++;
            else {
              clientTypeClients++;
              if ((c.spent ?? 0) === 0) clientTypeConsulted++;
            }
            const spent = c.spent ?? 0;
            if (spent >= 100000) clientTypeStars++;
            else if (spent > 0) clientTypeGood++;
            if (c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '') consultationHasConsultation++;
            const consultCreatedAt = getConsultCreatedAt(c);
            if (consultCreatedAt) {
              const m = toYyyyMm(consultCreatedAt);
              if (m === currentMonthKyiv) consultationCreatedCur++;
              if (toKyivDay(consultCreatedAt) === todayKyivDay) consultationCreatedToday++;
            }
            if (c.consultationBookingDate) {
              const m = toYyyyMm(c.consultationBookingDate);
              if (m === currentMonthKyiv) consultationAppointedCur++;
              const day = toKyivDay(c.consultationBookingDate);
              if (day && day < todayKyivDay) consultationAppointedPast++;
              else if (day === todayKyivDay) consultationAppointedToday++;
              else if (day && day > todayKyivDay) consultationAppointedFuture++;
            }
            if (c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '') {
              recordHasRecord++;
              if (c.consultationAttended === true) recordNewClient++;
              const recCreated = (c as any).paidServiceRecordCreatedAt;
              if (recCreated) {
                const recIso = typeof recCreated === 'string' ? recCreated : (recCreated as Date)?.toISOString?.();
                if (recIso && toYyyyMm(recIso) === currentMonthKyiv) recordCreatedCur++;
                if (recIso && toKyivDay(recIso) === todayKyivDay) recordCreatedToday++;
              }
              const paidDay = toKyivDay(c.paidServiceDate);
              if (paidDay) {
                if (toYyyyMm(c.paidServiceDate) === currentMonthKyiv) recordAppointedCur++;
                if (paidDay < todayKyivDay) recordAppointedPast++;
                else if (paidDay === todayKyivDay) recordAppointedToday++;
                else recordAppointedFuture++;
              }
            }
          }

          let binotelCallsFilterCounts = { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 };
          try {
            const binotelRows = await prisma.$queryRaw<
              Array<{ incoming: number; outgoing: number; success: number; fail: number }>
            >`
              WITH ranked AS (
                SELECT "clientId", "callType", disposition,
                  ROW_NUMBER() OVER (PARTITION BY "clientId" ORDER BY "startTime" DESC) AS rn
                FROM direct_client_binotel_calls
                WHERE "clientId" IS NOT NULL
              )
              SELECT
                COALESCE(SUM(CASE WHEN "callType" = 'incoming' THEN 1 ELSE 0 END), 0)::int AS incoming,
                COALESCE(SUM(CASE WHEN "callType" = 'outgoing' THEN 1 ELSE 0 END), 0)::int AS outgoing,
                COALESCE(SUM(CASE WHEN disposition IN ('ANSWER','VM-SUCCESS','SUCCESS') THEN 1 ELSE 0 END), 0)::int AS success,
                COALESCE(SUM(CASE WHEN disposition NOT IN ('ANSWER','VM-SUCCESS','SUCCESS') THEN 1 ELSE 0 END), 0)::int AS fail
              FROM ranked
              WHERE rn = 1
            `;
            if (binotelRows[0]) binotelCallsFilterCounts = { ...binotelRows[0], onlyNew: 0 };
            const phoneToClientIds = new Map<string, string[]>();
            for (const c of clients) {
              const norm = normalizePhone(c.phone);
              if (!norm) continue;
              const arr = phoneToClientIds.get(norm) ?? [];
              if (!arr.includes(c.id)) arr.push(c.id);
              phoneToClientIds.set(norm, arr);
            }
            for (const c of clients) {
              if (c.state !== 'binotel-lead' || c.altegioClientId) continue;
              const norm = normalizePhone(c.phone);
              if (!norm) continue;
              const ids = phoneToClientIds.get(norm) ?? [];
              if (ids.length === 1 && ids[0] === c.id) binotelCallsFilterCounts.onlyNew++;
            }
          } catch (binErr) {
            console.warn('[direct/clients] binotelCallsFilterCounts failed:', binErr);
          }

          mainFilterCounts = {
            stateCounts,
            daysCounts,
            instCounts,
            binotelCallsFilterCounts,
            clientTypeCounts: { leads: clientTypeLeads, clients: clientTypeClients, consulted: clientTypeConsulted, good: clientTypeGood, stars: clientTypeStars },
            consultationCounts: {
              hasConsultation: consultationHasConsultation,
              createdCur: consultationCreatedCur,
              createdToday: consultationCreatedToday,
              appointedCur: consultationAppointedCur,
              appointedPast: consultationAppointedPast,
              appointedToday: consultationAppointedToday,
              appointedFuture: consultationAppointedFuture,
            },
            recordCounts: {
              hasRecord: recordHasRecord,
              newClient: recordNewClient,
              createdCur: recordCreatedCur,
              createdToday: recordCreatedToday,
              appointedCur: recordAppointedCur,
              appointedPast: recordAppointedPast,
              appointedToday: recordAppointedToday,
              appointedFuture: recordAppointedFuture,
            },
          };
        } catch (err) {
          console.warn('[direct/clients] mainFilterCounts failed:', err);
        }
      }

      try {
        const withAltegio = clients.filter((c) => !!c.altegioClientId);
        const withAltegioNoName = withAltegio.filter((c) => !(c.firstName && c.firstName.trim()) && !(c.lastName && c.lastName.trim()));
        const withAltegioSourceInstagram = withAltegio.filter((c) => c.source === 'instagram').length;
      } catch {}
      if (clients.length === 0) {
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
    try {
      const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
      const dms = await getAllDirectMasters();
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
    }

    // Fallback: дотягування paidServiceTotalCost — API спочатку, потім KV (вебхуки)
    const companyId = parseInt(process.env.ALTEGIO_COMPANY_ID || '0', 10);
    const MAX_FALLBACK_PER_REQUEST = 30; // було 10 — клієнти за межами ліміту не оброблялись (напр. Єлизавета Брищук)

    const needsTotalCost = (c: any) =>
      c.paidServiceDate &&
      (typeof c.paidServiceTotalCost !== 'number' || c.paidServiceTotalCost <= 0);

    if (companyId && !Number.isNaN(companyId)) {
      // Етап A: є paidServiceVisitId — підвантажуємо breakdown з API
      const needFallbackA = clients.filter(
        (c) =>
          needsTotalCost(c) &&
          (c as any).paidServiceVisitId != null &&
          (typeof (c as any).paidServiceTotalCost !== 'number' ||
            !Array.isArray((c as any).paidServiceVisitBreakdown) ||
            (c as any).paidServiceVisitBreakdown.length === 0)
      );
      for (const c of needFallbackA) {
        try {
          const visitId = (c as any).paidServiceVisitId;
          const recordId = (c as any).paidServiceRecordId;
          const breakdown = await fetchVisitBreakdownFromAPI(Number(visitId), companyId, recordId != null ? Number(recordId) : undefined);
          if (breakdown && breakdown.length > 0) {
            const totalCost = breakdown.reduce((a, b) => a + b.sumUAH, 0);
            const idx = clients.findIndex((x) => x.id === c.id);
            if (idx >= 0) {
              const updateSpent = ((c as any).spent ?? 0) === 0 && totalCost > 0;
              clients[idx] = {
                ...clients[idx],
                paidServiceTotalCost: totalCost,
                paidServiceVisitBreakdown: breakdown,
                ...(updateSpent ? { spent: totalCost } : {}),
              } as DirectClient;
              try {
                await saveDirectClient(clients[idx], 'direct-clients-fallback-breakdown-api', {
                  visitId,
                  totalCost,
                });
              } catch {
                // лишаємо в відповіді, не зберігаємо
              }
            }
          }
        } catch {
          // ігноруємо помилку для окремого клієнта
        }
      }

      // Етап B: немає paidServiceVisitId — беремо visitId з API getClientRecords
      const needFallbackBFull = clients.filter(
        (c) =>
          needsTotalCost(c) &&
          (c as any).paidServiceVisitId == null &&
          (c as any).altegioClientId != null
      );
      const needFallbackB = needFallbackBFull.slice(0, MAX_FALLBACK_PER_REQUEST);
      if (needFallbackBFull.length > MAX_FALLBACK_PER_REQUEST) {
        console.log(`[direct/clients] fallback B: обробляємо ${MAX_FALLBACK_PER_REQUEST} з ${needFallbackBFull.length} клієнтів без visitId`);
      }
      for (const c of needFallbackB) {
        try {
          const id = Number((c as any).altegioClientId);
          const paidDate = (c as any).paidServiceDate;
          const paidKyivDay = paidDate ? kyivDayFromISO(typeof paidDate === 'string' ? paidDate : (paidDate as Date).toISOString?.() ?? '') : '';
          if (!paidKyivDay) continue;

          const records = await getClientRecords(companyId, id);
          const dayRecords = records.filter((r) => r.date && kyivDayFromISO(r.date) === paidKyivDay);
          const paidRecord = dayRecords.find((r) => !isConsultationService(r.services ?? []).isConsultation) ?? dayRecords[0];
          const visitId = paidRecord?.visit_id ?? null;
          if (visitId == null) continue;

          const breakdown = await fetchVisitBreakdownFromAPI(visitId, companyId);
          if (breakdown && breakdown.length > 0) {
            const totalCost = breakdown.reduce((a, b) => a + b.sumUAH, 0);
            const idx = clients.findIndex((x) => x.id === c.id);
            if (idx >= 0) {
              const updateSpent = ((c as any).spent ?? 0) === 0 && totalCost > 0;
              clients[idx] = {
                ...clients[idx],
                paidServiceTotalCost: totalCost,
                paidServiceVisitBreakdown: breakdown,
                paidServiceVisitId: visitId,
                ...(updateSpent ? { spent: totalCost } : {}),
              } as DirectClient;
              try {
                await saveDirectClient(clients[idx], 'direct-clients-fallback-breakdown-api-no-visitid', {
                  visitId,
                  totalCost,
                });
              } catch {
                // лишаємо в відповіді
              }
            }
          }
        } catch {
          // ігноруємо
        }
      }

      // Етап C: KV fallback — якщо API не дав даних
      const stillNeedFallbackFull = clients.filter((c) => needsTotalCost(c));
      const stillNeedFallback = stillNeedFallbackFull.slice(0, MAX_FALLBACK_PER_REQUEST);
      if (stillNeedFallbackFull.length > MAX_FALLBACK_PER_REQUEST) {
        const skipped = stillNeedFallbackFull.slice(MAX_FALLBACK_PER_REQUEST);
        const skippedNames = skipped.map((s: any) => s.clientName || s.id).slice(0, 5);
        console.log(`[direct/clients] fallback C: обробляємо ${MAX_FALLBACK_PER_REQUEST} з ${stillNeedFallbackFull.length} (пропущено: ${skipped.length}). Приклади пропущених: ${skippedNames.join(', ')}`);
      }
      if (stillNeedFallback.length > 0) {
        try {
          const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
          const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
          const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
          const groupsByClient = groupRecordsByClientDay(normalizedEvents);

          let fallbackUpdated = 0;
          for (const c of stillNeedFallback) {
            const id = Number((c as any).altegioClientId);
            if (!Number.isFinite(id)) continue;
            const paidDate = (c as any).paidServiceDate;
            const paidKyivDay = paidDate ? kyivDayFromISO(typeof paidDate === 'string' ? paidDate : (paidDate as Date).toISOString?.() ?? '') : '';
            if (!paidKyivDay) continue;

            const groups = groupsByClient.get(id) || [];
            const paidGroups = groups.filter((g: any) => g.groupType === 'paid');
            const paidGroup = paidGroups.find((g: any) => (g.kyivDay || '') === paidKyivDay) ?? paidGroups[0];
            if (!paidGroup) continue;

            const totalCost = computeGroupTotalCostUAH(paidGroup);
            if (totalCost <= 0) continue;

            const visitId = getMainVisitIdFromGroup(paidGroup);
            const breakdown = getPerMasterSumsFromGroup(paidGroup, visitId ?? undefined);

            const idx = clients.findIndex((x) => x.id === c.id);
            if (idx >= 0) {
              const updateSpent = ((c as any).spent ?? 0) === 0 && totalCost > 0;
              clients[idx] = {
                ...clients[idx],
                paidServiceTotalCost: totalCost,
                paidServiceVisitBreakdown: breakdown.length > 0 ? breakdown : undefined,
                paidServiceVisitId: visitId ?? undefined,
                ...(updateSpent ? { spent: totalCost } : {}),
              } as DirectClient;
              try {
                await saveDirectClient(clients[idx], 'direct-clients-fallback-breakdown-kv', {
                  totalCost,
                  source: 'kv',
                });
                fallbackUpdated++;
              } catch {
                // лишаємо в відповіді
              }
            }
          }
          if (fallbackUpdated > 0 || stillNeedFallback.length > 0) {
            const skipped = stillNeedFallbackFull.length - stillNeedFallback.length;
            console.log(`[direct/clients] fallback C: оброблено ${stillNeedFallback.length}, оновлено ${fallbackUpdated}${skipped > 0 ? `, пропущено через ліміт: ${skipped}` : ''}`);
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ KV fallback для paidServiceTotalCost не вдався:', err);
        }
      }
    }

    // Завантажуємо відповідальних для сортування по імені (якщо потрібно)
    let masterMap = new Map<string, string>();
    // Мапа для перевірки, чи майстер є адміністратором (за ім'ям)
    let masterNameToRole = new Map<string, 'master' | 'direct-manager' | 'admin'>();
    if (sortBy === 'masterId') {
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
        // Створюємо мапу ім'я -> роль для перевірки адміністраторів
        masterNameToRole = new Map(masters.map((m: any) => [m.name?.toLowerCase().trim() || '', m.role || 'master']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for sorting:', err);
        // Fallback на старий метод
        try {
          const { getMasters } = await import('@/lib/photo-reports/service');
          const masters = getMasters();
          masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
        } catch (fallbackErr) {
          console.warn('[direct/clients] Fallback to old masters also failed:', fallbackErr);
        }
      }
    } else {
      // Завантажуємо майстрів для перевірки ролей (навіть якщо не сортуємо)
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterNameToRole = new Map(masters.map((m: any) => [m.name?.toLowerCase().trim() || '', m.role || 'master']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for role check:', err);
      }
    }
    
    // Допоміжна функція для перевірки, чи майстер є адміністратором (перевіряє і роль в БД)
    const isAdminByName = (name: string | null | undefined): boolean => {
      if (!name) return false;
      const n = name.toLowerCase().trim();
      // Спочатку перевіряємо за ім'ям (якщо містить "адм")
      if (isAdminStaffName(n)) return true;
      // Потім перевіряємо роль в базі даних
      const role = masterNameToRole.get(n);
      return role === 'admin' || role === 'direct-manager';
    };

    // Для statsFullPicture: повний список з consultationBookingDate (KV fallback) — рядок «Заплановано» не залежить від фільтрів.
    let clientsForBookedStatsBase: DirectClient[] = [];
    if (statsOnly && statsFullPicture) {
      try {
        const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
        const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 9999);
        const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
        const groupsByClient = groupRecordsByClientDay(normalizedEvents);
        const todayKyiv = kyivDayFromISO(new Date().toISOString());
        const [y, m] = todayKyiv.split('-');
        const year = Number(y);
        const month = Number(m);
        const monthIdx = Math.max(0, month - 1);
        const lastDay = new Date(year, monthIdx + 1, 0).getDate();
        const pad = (n: number) => String(n).padStart(2, '0');
        const monthEnd = `${y}-${m}-${pad(lastDay)}`;
        const nowTs = Date.now();
        const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
        clientsForBookedStatsBase = clients.map((c) => {
          let out = { ...c };
          if (out.altegioClientId && !out.consultationBookingDate) {
            const groups = groupsByClient.get(Number(out.altegioClientId)) ?? groupsByClient.get(out.altegioClientId) ?? [];
            const consultGroups = groups.filter((g: any) => g?.groupType === 'consultation');
            let best: any = null;
            let bestTs = Infinity;
            for (const g of consultGroups) {
              const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
              if (!dt) continue;
              const ts = new Date(dt).getTime();
              if (!isFinite(ts)) continue;
              const diff = ts - nowTs;
              const groupDay = kyivDayFromISO(dt);
              const isToday = !!groupDay && groupDay === todayKyiv;
              const isFutureToMonthEnd = !!groupDay && groupDay > todayKyiv && groupDay <= monthEnd;
              const isFutureWithin365Days = diff >= 0 && diff <= maxFutureMs;
              if (!isToday && !isFutureToMonthEnd && !isFutureWithin365Days) continue;
              if (ts < bestTs) {
                bestTs = ts;
                best = g;
              }
            }
            if (best && isFinite(bestTs)) {
              out = { ...out, consultationBookingDate: new Date(bestTs).toISOString() };
            }
          }
          const shouldIgnoreConsult = (out.visits ?? 0) >= 2 && !out.consultationBookingDate;
          if (shouldIgnoreConsult) {
            out = {
              ...out,
              consultationBookingDate: undefined,
              consultationDate: undefined,
            };
          }
          return out;
        });
      } catch (err) {
        console.warn('[direct/clients] statsFullPicture: не вдалося побудувати clientsForBookedStatsBase:', err);
      }
    }

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

    // Обчислюємо прапори "Перезапис" (🔁) для клієнтів, які мають Altegio ID і paidServiceDate.
    // Умови:
    // - поточний paid запис (той що показуємо) був створений в день attended paid-візиту (Europe/Kyiv)
    // - атрибуція: майстер = перший receivedAt у attended-групі (exclude admin/unknown)
    try {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 9999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      const groupsByClient = groupRecordsByClientDay(normalizedEvents);
      // Map використовує number-ключі; altegioClientId інколи може прийти іншим типом — fallback для пошуку.
      const getGroupsFor = (aid: number | undefined) =>
        aid == null ? [] : groupsByClient.get(Number(aid)) ?? groupsByClient.get(aid) ?? [];
      const todayKyivDay = kyivDayFromISO(new Date().toISOString());

      clients = clients.map((c) => {
        // Дораховуємо "поточний Майстер" для UI з KV (щоб збігалось з модалкою "Webhook-и").
        // Бізнес-правило для колонки "Майстер": ігноруємо адмінів/невідомих, пріоритет = paid-запис (якщо він є).
        try {
          if (c.altegioClientId) {
            const groups = getGroupsFor(c.altegioClientId);
            // paidRecordsInHistoryCount — з БД (Altegio API visits/search при вебхуку), не з KV.
            // Дані consultationBookingDate, paidServiceDate — тільки з БД (вебхук/синхронізація). Без KV fallback.
            // Номер спроби консультації: 2/3/… (збільшуємо ТІЛЬКИ після no-show).
            // Правило: для поточної consultationBookingDate номер = 1 + кількість no-show консультацій ДО цієї дати (Europe/Kyiv).
            // Переноси ДО дати (без no-show) не збільшують.
            try {
              if (c.consultationBookingDate) {
                const currentDay = kyivDayFromISO(String(c.consultationBookingDate));
                if (currentDay) {
                  const noShowBefore = groups.filter((g: any) => {
                    if (!g || g.groupType !== 'consultation') return false;
                    const day = (g.kyivDay || '').toString();
                    if (!day) return false;
                    if (day >= currentDay) return false; // тільки ДО поточної дати
                    // no-show = attendanceStatus 'no-show' (cancelled окремо) або attendance === -1
                    const status = (g.attendanceStatus || '').toString();
                    const att = (g.attendance ?? null) as any;
                    return status === 'no-show' || att === -1;
                  }).length;

                  const attemptNumber = 1 + noShowBefore;
                  if (attemptNumber >= 2) {
                    c = { ...c, consultationAttemptNumber: attemptNumber };
                  } else {
                    c = { ...c, consultationAttemptNumber: undefined };
                  }
                } else {
                  c = { ...c, consultationAttemptNumber: undefined };
                }
              } else {
                c = { ...c, consultationAttemptNumber: undefined };
              }
            } catch (err) {
              console.warn('[direct/clients] ⚠️ Не вдалося порахувати consultationAttemptNumber:', err);
            }

            const pickClosestGroup = (groupType: 'paid' | 'consultation', targetISO: string) => {
              const targetTs = new Date(targetISO).getTime();
              if (!isFinite(targetTs)) return null;
              const targetDay = kyivDayFromISO(targetISO);
              const sameDay = targetDay
                ? (groups.find((g: any) => (g?.groupType === groupType) && (g?.kyivDay || '') === targetDay) || null)
                : null;
              if (sameDay) return sameDay;

              let best: any = null;
              let bestDiff = Infinity;
              for (const g of groups) {
                if ((g as any)?.groupType !== groupType) continue;
                const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
                if (!dt) continue;
                const ts = new Date(dt).getTime();
                if (!isFinite(ts)) continue;
                const diff = Math.abs(ts - targetTs);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  best = g;
                }
              }
              // Фолбек тільки якщо це справді той самий запис (до 24 год різниці)
              if (best && bestDiff <= 24 * 60 * 60 * 1000) return best;
              return null;
            };

            // ВАЖЛИВО (оновлене правило): "Майстер" — ТІЛЬКИ для платних записів.
            // Якщо в клієнта немає paidServiceDate — в UI робимо колонку порожньою, навіть якщо в БД щось залишилось.
            if (!c.paidServiceDate) {
              c = {
                ...c,
                serviceMasterName: undefined,
                serviceMasterAltegioStaffId: null,
                serviceSecondaryMasterName: undefined,
              };
            } else {
              const paidGroup = pickClosestGroup('paid', c.paidServiceDate);
              const chosen = paidGroup;
              // З KV підставляємо дату створення запису лише коли є; інакше зберігаємо значення з БД (для крапочки).
              const paidRecordCreatedAt = pickRecordCreatedAtISOFromGroup(chosen);
              if (paidRecordCreatedAt) {
                c = { ...c, paidServiceRecordCreatedAt: paidRecordCreatedAt };
              } else if (c.paidServiceDate && c.altegioClientId) {
                // Fallback: група ключується по дню події (створення), а не по дню візиту — шукаємо дату створення в усіх paid-групах клієнта.
                const groups = getGroupsFor(c.altegioClientId);
                const paidGroups = (groups || []).filter((g: any) => g?.groupType === 'paid');
                const createdDates: { iso: string; ts: number }[] = [];
                const paidDateTs = new Date(c.paidServiceDate).getTime();
                for (const g of paidGroups) {
                  const iso = pickRecordCreatedAtISOFromGroup(g);
                  if (iso && Number.isFinite(paidDateTs)) {
                    const ts = new Date(iso).getTime();
                    if (Number.isFinite(ts)) createdDates.push({ iso, ts });
                  }
                }
                if (createdDates.length > 0) {
                  // Обираємо дату найближчу до paidServiceDate (візиту), щоб прив'язати до поточного запису.
                  const best = createdDates.reduce((a, b) =>
                    Math.abs(a.ts - paidDateTs) <= Math.abs(b.ts - paidDateTs) ? a : b
                  );
                  c = { ...c, paidServiceRecordCreatedAt: best.iso };
                  // Зберігаємо в БД асинхронно, щоб наступні запити отримували поле навіть без KV (крапочка на Запис).
                  prisma.directClient
                    .update({
                      where: { id: c.id },
                      data: { paidServiceRecordCreatedAt: new Date(best.iso) },
                    })
                    .catch((err) =>
                      console.warn('[direct/clients] Помилка збереження paidServiceRecordCreatedAt з fallback:', err)
                    );
                }
              }
              // Якщо KV не повернув дату — не перезаписуємо paidServiceRecordCreatedAt на undefined, щоб крапочка могла бути на Записі.
              if (chosen) {
                const pair = pickNonAdminStaffPairFromGroup(chosen as any, 'first');
                // Додаткова перевірка: фільтруємо адміністраторів за роллю в БД
                const filteredPair = pair.filter(p => {
                  if (!p.staffName) return false;
                  return !isAdminByName(p.staffName);
                });
                const primary = filteredPair[0] || null;
                const secondary = filteredPair[1] || null;
                if (primary?.staffName) {
                  // Якщо майстер уже заданий в БД (і це не адмін/пусто) — не перетираємо.
                  // Це дозволяє точково виправляти 1-2 кейси без “авто-переобчислення” з KV.
                  const currentName = (c.serviceMasterName || '').toString().trim();
                  const shouldReplace = !currentName || isAdminByName(currentName);
                  if (!shouldReplace) {
                    // залишаємо як є, але вторинного майстра можемо дорахувати (не критично)
                    c = {
                      ...c,
                      serviceSecondaryMasterName: secondary?.staffName ? String(secondary.staffName) : c.serviceSecondaryMasterName,
                    };
                  } else {
                  c = {
                    ...c,
                    serviceMasterName: String(primary.staffName),
                    serviceMasterAltegioStaffId: primary.staffId ?? null,
                    serviceSecondaryMasterName: secondary?.staffName ? String(secondary.staffName) : undefined,
                  };
                  }
                } else {
                  // Якщо після фільтрації не залишилося майстрів - очищаємо serviceMasterName
                  // (не встановлюємо адміністратора як fallback)
                  c = {
                    ...c,
                    serviceMasterName: undefined,
                    serviceMasterAltegioStaffId: null,
                    serviceSecondaryMasterName: undefined,
                  };
                }
              }
              const handsCnt = chosen ? countNonAdminStaffInGroup(chosen as any) : 0;
              const hands = chosen ? (handsCnt <= 1 ? 2 : handsCnt === 2 ? 4 : 6) as 2 | 4 | 6 : undefined;
              c = { ...c, paidServiceHands: hands };
              // Розбиття сум по майстрах — тільки з БД (API Altegio). Без KV.
              const dbBreakdown = (c as any).paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
              if (Array.isArray(dbBreakdown) && dbBreakdown.length > 0) {
                c = { ...c, paidServiceMastersBreakdown: dbBreakdown } as typeof c & { paidServiceMastersBreakdown: { masterName: string; sumUAH: number }[] };
              }
            }
            
            // ВАЖЛИВО: Фільтруємо адміністраторів з serviceMasterName, навіть якщо вони вже є в БД
            // Це очищає існуючі дані, де адміністратори (наприклад, Вікторія) були встановлені раніше
            if (c.serviceMasterName) {
              const currentMasterName = (c.serviceMasterName || '').toString().trim();
              if (currentMasterName && isAdminByName(currentMasterName)) {
                // Очищаємо serviceMasterName, якщо це адміністратор
                c = {
                  ...c,
                  serviceMasterName: undefined,
                  serviceMasterAltegioStaffId: null,
                };
              }
            }
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося дорахувати serviceMasterName з KV (не критично):', err);
        }

        // Дораховуємо "хто консультував" для UI (щоб не чекати cron), якщо є дата консультації.
        // Правило:
        // - беремо consultation-групу на kyivDay консультації
        // - показуємо останнього МАЙСТРА (не-адміна) за receivedAt
        // - якщо майстра нема — fallback на адміна
        // - якщо немає жодного staffName — лишаємо як є (UI покаже "невідомо")
        try {
          if (c.altegioClientId && c.consultationBookingDate) {
            const groups = getGroupsFor(c.altegioClientId);
            const consultDay = kyivDayFromISO(c.consultationBookingDate);
            const consultGroup =
              consultDay
                ? (groups.find((g: any) => (g?.groupType === 'consultation') && (g?.kyivDay || '') === consultDay) || null)
                : null;

            // ВАЖЛИВО: attendance в UI має відповідати KV-групі того ДНЯ, який показуємо.
            // Тому для відповіді /clients ми пріоритезуємо KV-групу (як у модалці "Webhook-и"),
            // але НЕ перетираємо true на false.
            const pickClosestConsultGroup = () => {
              if (consultGroup) return consultGroup;
              if (!groups.length) return null;
              const bookingTs = new Date(c.consultationBookingDate as any).getTime();
              if (!isFinite(bookingTs)) return null;
              let best: any = null;
              let bestDiff = Infinity;
              for (const g of groups) {
                if ((g as any)?.groupType !== 'consultation') continue;
                const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
                if (!dt) continue;
                const ts = new Date(dt).getTime();
                if (!isFinite(ts)) continue;
                const diff = Math.abs(ts - bookingTs);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  best = g;
                }
              }
              // фолбек тільки якщо дуже близько (до 24 год)
              if (best && bestDiff <= 24 * 60 * 60 * 1000) return best;
              return null;
            };

            // Дата створення запису (для tooltip у таблиці): беремо earliest "create" з KV-івентів по цій даті.
            try {
              const chosenConsult = pickClosestConsultGroup();
              const consultRecordCreatedAt = pickRecordCreatedAtISOFromGroup(chosenConsult);
              if (consultRecordCreatedAt) {
                c = { ...c, consultationRecordCreatedAt: consultRecordCreatedAt };
              } else {
                c = { ...c, consultationRecordCreatedAt: undefined };
              }
            } catch {
              c = { ...c, consultationRecordCreatedAt: undefined };
            }

            const cg = pickClosestConsultGroup();
            if (cg) {
              // ВАЖЛИВО: Оновлюємо attendance ТІЛЬКИ з групи ТОГО САМОГО ДНЯ, що consultationBookingDate.
              // Якщо consultGroup === null, pickClosestConsultGroup може повернути групу іншого дня (fallback до 24 год).
              // Тоді attStatus (no-show) від минулої консультації був би застосований до поточної — і «Очікується»
              // потрапляв би у фільтр «Не з'явилась». Тому перезаписуємо attendance тільки з consultGroup (exact match).
              if (cg !== consultGroup) {
                // cg — це fallback-група іншого дня; не торкаємося consultationAttended
              } else {
                const attStatus = String((cg as any).attendanceStatus || '');
                // ВАЖЛИВО: Оновлюємо attendance тільки якщо в KV є чіткий статус (arrived/no-show/cancelled)
                // Якщо статус 'pending' або невідомо - зберігаємо значення з БД (не скидаємо до null)
                if (attStatus === 'arrived' || (cg as any).attendance === 1 || (cg as any).attendance === 2) {
                  const attVal = (cg as any).attendance;
                  c = {
                    ...c,
                    consultationAttended: true,
                    consultationCancelled: false,
                    ...(typeof attVal === 'number' && (attVal === 1 || attVal === 2)
                      ? { consultationAttendanceValue: attVal as 1 | 2 }
                      : {}),
                  };
                } else if (attStatus === 'no-show' || (cg as any).attendance === -1) {
                  // Встановлюємо false тільки якщо в БД ще не встановлено true
                  if ((c as any).consultationAttended !== true) {
                    c = { ...c, consultationAttended: false, consultationCancelled: false };
                  }
                } else if (attStatus === 'cancelled' || (cg as any).attendance === -2) {
                  // Встановлюємо null тільки якщо в БД ще не встановлено true
                  if ((c as any).consultationAttended !== true) {
                    c = { ...c, consultationAttended: null, consultationCancelled: true };
                  } else {
                    c = { ...c, consultationCancelled: false };
                  }
                }
                // Дата встановлення статусу для тултіпа: з групи (той самий джерело, що в record-history).
                // Пріоритет: значення з БД (вебхук), інакше з групи — щоб тултіп збігався з модалкою «Історія консультацій».
                const groupAttendanceSetAt = (cg as any).attendanceSetAt;
                if (groupAttendanceSetAt) {
                  c = { ...c, consultationAttendanceSetAt: (c as any).consultationAttendanceSetAt ?? groupAttendanceSetAt };
                }
                // Якщо статус 'pending' або невідомо - НЕ змінюємо значення з БД
                // Це дозволяє зберегти встановлені раніше значення, навіть якщо в KV storage немає даних
              }
            }
            // Якщо групу не знайдено - також НЕ змінюємо значення з БД
            // Це дозволяє зберегти встановлені раніше значення для старих записів

            if (consultGroup) {
              const events = Array.isArray((consultGroup as any).events) ? (consultGroup as any).events : [];
              const sorted = [...events].sort((a: any, b: any) => {
                const ta = new Date(b?.receivedAt || b?.datetime || 0).getTime();
                const tb = new Date(a?.receivedAt || a?.datetime || 0).getTime();
                return ta - tb;
              });

              const isKnownName = (ev: any) => {
                const name = (ev?.staffName || '').toString().trim();
                if (!name) return false;
                if (name.toLowerCase().includes('невідом')) return false;
                return true;
              };

              // ВАЖЛИВО: не використовуємо адміністраторів як fallback
              // Якщо немає не-адміністраторів - не встановлюємо consultationMasterName
              const lastNonAdmin = sorted.find((ev: any) => isKnownName(ev) && !isAdminByName((ev.staffName || '').toString()));
              const chosen = lastNonAdmin || null;

              if (chosen?.staffName) {
                const current = (c.consultationMasterName || '').toString().trim();
                const shouldReplace = !current || isAdminByName(current);
                if (shouldReplace) {
                  c = { ...c, consultationMasterName: String(chosen.staffName) };
                }
              }
            }
          }

          // lastActivityKeys repair: якщо attendance з KV (або вже в БД), але ключа немає — додаємо для відповіді (in-memory).
          // Крапочка показується тільки при lastActivityAt = сьогодні, тому ремонтуємо лише тоді.
          if (c.altegioClientId && c.consultationBookingDate) {
            const activityKeys = Array.isArray((c as any).lastActivityKeys) ? ((c as any).lastActivityKeys as string[]) : [];
            const hasConsultKey = activityKeys.includes('consultationAttended') || activityKeys.includes('consultationCancelled');
            const lastActAt = (c as any).lastActivityAt;
            const lastActAtDay = lastActAt
              ? kyivDayFromISO(typeof lastActAt === 'string' ? lastActAt : (lastActAt as Date)?.toISOString?.() ?? '')
              : '';
            const activityIsToday = !!lastActAtDay && lastActAtDay === todayKyivDay;
            const hasAttendanceStatus =
              c.consultationAttended === true ||
              c.consultationAttended === false ||
              (c as any).consultationCancelled === true;
            if (!hasConsultKey && activityIsToday && hasAttendanceStatus) {
              const newKey = (c as any).consultationCancelled === true ? 'consultationCancelled' : 'consultationAttended';
              c = { ...c, lastActivityKeys: [...activityKeys, newKey] } as typeof c;
            }
          }

          // lastActivityKeys repair для paidServiceRecordCreatedAt: щоб крапочка була на Записі, якщо запис створений сьогодні.
          const paidRecCreatedAt = (c as any).paidServiceRecordCreatedAt;
          if (paidRecCreatedAt) {
            const paidRecDay = kyivDayFromISO(typeof paidRecCreatedAt === 'string' ? paidRecCreatedAt : (paidRecCreatedAt as Date)?.toISOString?.() ?? '');
            const paidRecCreatedToday = !!paidRecDay && paidRecDay === todayKyivDay;
            const keysForPaid = Array.isArray((c as any).lastActivityKeys) ? ((c as any).lastActivityKeys as string[]) : [];
            if (paidRecCreatedToday && !keysForPaid.includes('paidServiceRecordCreatedAt')) {
              c = { ...c, lastActivityKeys: [...keysForPaid, 'paidServiceRecordCreatedAt'] } as typeof c;
            }
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося дорахувати consultationMasterName (не критично):', err);
        }

        if (!c.altegioClientId || !c.paidServiceDate) return c;
        const groups = getGroupsFor(c.altegioClientId);
        if (!groups.length) return c;

        const paidGroups = groups.filter((g: any) => g?.groupType === 'paid');
        if (!paidGroups.length) return c;

        const paidKyivDay = kyivDayFromISO(c.paidServiceDate);
        if (!paidKyivDay) return c;

        // Шукаємо групу так само як для "Майстер" — спочатку точний kyivDay, потім найближча в межах 24 год.
        let currentGroup = paidGroups.find((g: any) => (g?.kyivDay || '') === paidKyivDay) || null;
        if (!currentGroup) {
          const targetTs = new Date(c.paidServiceDate).getTime();
          if (isFinite(targetTs)) {
            let best: any = null;
            let bestDiff = Infinity;
            for (const g of paidGroups) {
              const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
              if (!dt) continue;
              const ts = new Date(dt).getTime();
              if (!isFinite(ts)) continue;
              const diff = Math.abs(ts - targetTs);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = g;
              }
            }
            if (best && bestDiff <= 24 * 60 * 60 * 1000) currentGroup = best;
          }
        }
        if (!currentGroup) return c;

        // Attendance для "Запис" має відповідати KV-групі цього дня.
        // ВАЖЛИВО: Оновлюємо attendance тільки якщо в KV є чіткий статус (arrived/no-show/cancelled)
        // Якщо статус 'pending' або невідомо - зберігаємо значення з БД (не скидаємо до null)
        try {
          const attStatus = String((currentGroup as any).attendanceStatus || '');
          const attVal = (currentGroup as any).attendance ?? null;
          if (attStatus === 'arrived' || attVal === 1 || attVal === 2) {
            c = {
              ...c,
              paidServiceAttended: true,
              paidServiceCancelled: false,
              ...(typeof attVal === 'number' && (attVal === 1 || attVal === 2)
                ? { paidServiceAttendanceValue: attVal as 1 | 2 }
                : {}),
            };
          } else if (attStatus === 'no-show' || attVal === -1) {
            // Встановлюємо false тільки якщо в БД ще не встановлено true
            if ((c as any).paidServiceAttended !== true) {
              c = { ...c, paidServiceAttended: false, paidServiceCancelled: false };
            }
          } else if (attStatus === 'cancelled' || attVal === -2) {
            // Встановлюємо null тільки якщо в БД ще не встановлено true
            if ((c as any).paidServiceAttended !== true) {
              c = { ...c, paidServiceAttended: null, paidServiceCancelled: true };
            } else {
              c = { ...c, paidServiceCancelled: false };
            }
          }
          // Якщо статус 'pending' або невідомо - НЕ змінюємо значення з БД
          // Це дозволяє зберегти встановлені раніше значення, навіть якщо в KV storage немає даних
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося нормалізувати paidServiceAttended з KV (не критично):', err);
        }

        // Сума платного запису — тільки з API Altegio (БД: вебхук/backfill). Жодних даних з KV.
        // Якщо є paidServiceMastersBreakdown з БД — узгоджуємо paidServiceTotalCost із сумою breakdown.
        const bd = (c as any).paidServiceMastersBreakdown as { masterName: string; sumUAH: number }[] | undefined;
        if (Array.isArray(bd) && bd.length > 0) {
          const totalFromBd = bd.reduce((a, x) => a + x.sumUAH, 0);
          c = { ...c, paidServiceTotalCost: totalFromBd };
        }

        // createdKyivDay = день створення поточного платного запису (create_date > receivedAt > datetime)
        const paidCreatedAt = pickRecordCreatedAtISOFromGroup(currentGroup);
        const createdKyivDay = paidCreatedAt ? kyivDayFromISO(paidCreatedAt) : '';
        if (!createdKyivDay) return c;

        // Перезапис тільки якщо є attended ПЛАТНА група в день створення запису.
        // Консультація (безкоштовна) не має відношення до перезапису.
        // ВАЖЛИВО: група має представляти реальний візит у createdKyivDay (datetime = той день),
        // а не лише подію створення запису, отриману в цей день (група з receivedAt, але datetime в майбутньому).
        const attendedPaidGroup =
          paidGroups.find((g: any) => {
            if ((g?.kyivDay || '') !== createdKyivDay) return false;
            if (!(g?.attendance === 1 || g?.attendance === 2 || g?.attendanceStatus === 'arrived')) return false;
            const groupDatetime = (g as any)?.datetime;
            if (!groupDatetime) return false; // Група без datetime = не реальний візит
            const visitDay = kyivDayFromISO(groupDatetime);
            return visitDay === createdKyivDay;
          }) || null;
        if (!attendedPaidGroup) return c;

        const picked = pickNonAdminStaffFromGroup(attendedPaidGroup, 'first');
        // Додаткова перевірка: якщо вибраний майстер є адміністратором за роллю - не використовуємо його
        const isValidMaster = picked?.staffName && !isAdminByName(picked.staffName);
        const finalPicked = isValidMaster ? picked : null;
        let pickedMasterId: string | undefined = undefined;
        if (finalPicked?.staffId != null) {
          // Перевага: матч по altegioStaffId
          for (const [dmId, staffId] of directMasterIdToStaffId.entries()) {
            if (staffId === picked.staffId) {
              pickedMasterId = dmId;
              break;
            }
          }
        }
        if (!pickedMasterId && finalPicked?.staffName) {
          const full = finalPicked.staffName.trim().toLowerCase();
          pickedMasterId = directMasterNameToId.get(full);
          if (!pickedMasterId) {
            const first = full.split(/\s+/)[0] || '';
            pickedMasterId = first ? directMasterNameToId.get(first) : undefined;
          }
        }

        // Перезапис = клієнт прийшов на візит (дата створення = букінгдата) → зелена галочка
        return {
          ...c,
          paidServiceIsRebooking: true,
          paidServiceAttended: true,
          paidServiceCancelled: false,
          paidServiceRebookFromKyivDay: createdKyivDay,
          paidServiceRebookFromMasterName: finalPicked?.staffName || undefined,
          paidServiceRebookFromMasterId: pickedMasterId,
        };
      });
    } catch (err) {
      console.warn('[direct/clients] ⚠️ Не вдалося обчислити "Перезапис" (не критично):', err);
    }

    // Отримуємо останні 5 станів для всіх клієнтів одним оптимізованим запитом
    const clientIds = clients.map(c => c.id);
    let statesMap = new Map<string, any[]>();
    try {
      statesMap = await getLast5StatesForClients(clientIds);
      console.log(`[direct/clients] GET: Loaded state history for ${statesMap.size} clients`);
    } catch (statesErr) {
      console.warn('[direct/clients] GET: Failed to load state history (non-critical):', statesErr);
      // Продовжуємо без історії станів
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

    // Додаємо останні 5 станів до кожного клієнта
    // getLast5StatesForClients вже відфільтрувала дублікати стану "client" та "lead"
    const clientsWithStates = clients.map(client => {
      const clientStates = statesMap.get(client.id) || [];
      return {
      ...client,
        last5States: clientStates,
      };
    });

    // Додаємо інфо для колонки "Переписка" (Inst): messagesTotal, chatNeedsAttention, бейджі статусу чату
    const clientsWithChatMeta = await enrichClientsWithChatMeta(clientsWithStates);

    // Додаємо метадані статусу дзвінків: callStatusName, callStatusBadgeKey, callStatusLogs
    const clientsWithCallMeta = await (async () => {
      try {
        const ids = clientsWithChatMeta.map((c) => c.id);
        if (!ids.length) return clientsWithChatMeta;

        const callStatusIds = Array.from(
          new Set(
            clientsWithChatMeta
              .map((c) => (c as any).callStatusId)
              .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
          )
        );

        const [callStatuses, callStatusLogs, binotelCounts, binotelLatestCalls] = await Promise.all([
          callStatusIds.length > 0
            ? prisma.directCallStatus.findMany({
                where: { id: { in: callStatusIds } },
                select: { id: true, name: true, badgeKey: true },
              })
            : [],
          prisma.directClientCallStatusLog.findMany({
            where: { clientId: { in: ids } },
            include: { toStatus: { select: { name: true } } },
            orderBy: { changedAt: 'desc' },
          }),
          prisma.directClientBinotelCall.groupBy({
            by: ['clientId'],
            // in: ids уже виключає null (null не збігається з жодним id)
            where: { clientId: { in: ids } },
            _count: { id: true },
          }),
          ids.length > 0
            ? (prisma.$queryRaw`
                SELECT DISTINCT ON ("clientId") "clientId", "generalCallID", "callType", "disposition", "startTime", "rawData"
                FROM "direct_client_binotel_calls"
                WHERE "clientId" IN (${Prisma.join(ids)})
                ORDER BY "clientId", "startTime" DESC
              ` as Promise<
                Array<{
                  clientId: string | null;
                  generalCallID: string;
                  callType: string;
                  disposition: string;
                  startTime: Date;
                  rawData: unknown;
                }>
              >)
            : [],
        ]);

        function extractRecordingUrl(raw: unknown): string | null {
          if (!raw || typeof raw !== 'object') return null;
          const r = raw as Record<string, unknown>;
          const candidates = [
            r.linkToCallRecordInMyBusiness,
            r.linkToCallRecordOverlayInMyBusiness,
            r.recordingUrl,
            r.audio_path,
            r.recordingLink,
            r.recording,
          ];
          for (const v of candidates) {
            if (typeof v === 'string' && v.startsWith('http')) return v;
          }
          return null;
        }

        const binotelLatestRecordingMap = new Map<string, string>();
        const binotelLatestGeneralIdMap = new Map<string, string>();
        const binotelLatestCallTypeMap = new Map<string, string>();
        const binotelLatestCallDispositionMap = new Map<string, string>();
        const binotelLatestCallStartTimeMap = new Map<string, Date>();
        const seenClientIds = new Set<string>();
        for (const row of binotelLatestCalls) {
          if (!row.clientId || seenClientIds.has(row.clientId)) continue;
          seenClientIds.add(row.clientId);
          const url = extractRecordingUrl(row.rawData);
          if (url) binotelLatestRecordingMap.set(row.clientId, url);
          const gid = (row as { generalCallID?: string }).generalCallID;
          if (gid && !gid.startsWith('gen-')) {
            binotelLatestGeneralIdMap.set(row.clientId, gid);
          }
          const ct = (row as { callType?: string }).callType;
          if (ct) binotelLatestCallTypeMap.set(row.clientId, ct);
          const disp = (row as { disposition?: string }).disposition;
          if (disp) binotelLatestCallDispositionMap.set(row.clientId, disp);
          const st = (row as { startTime?: Date }).startTime;
          if (st) binotelLatestCallStartTimeMap.set(row.clientId, st);
        }

        const callStatusMap = new Map<string, { name: string; badgeKey: string }>();
        for (const s of callStatuses) {
          callStatusMap.set(s.id, { name: s.name, badgeKey: (s as any).badgeKey || 'badge_1' });
        }

        const logsByClient = new Map<string, Array<{ statusName: string; changedAt: string }>>();
        for (const log of callStatusLogs) {
          const statusName = (log as any).toStatus?.name ?? '—';
          const arr = logsByClient.get(log.clientId) ?? [];
          if (arr.length < 50) arr.push({ statusName, changedAt: log.changedAt.toISOString() });
          logsByClient.set(log.clientId, arr);
        }

        const binotelCountMap = new Map<string, number>();
        for (const r of binotelCounts) {
          if (r.clientId) binotelCountMap.set(r.clientId, (r as any)._count?.id ?? 0);
        }

        return clientsWithChatMeta.map((c) => {
          const callStId = ((c as any).callStatusId || '').toString().trim() || '';
          const callSt = callStId ? callStatusMap.get(callStId) : null;
          const callLogs = logsByClient.get(c.id) ?? [];
          const binotelCallsCount = binotelCountMap.get(c.id) ?? 0;
          const binotelLatestCallRecordingUrl = binotelLatestRecordingMap.get(c.id) ?? null;
          const binotelLatestCallGeneralID = binotelLatestGeneralIdMap.get(c.id) ?? null;
          const binotelLatestCallType = binotelLatestCallTypeMap.get(c.id) ?? null;
          const binotelLatestCallDisposition = binotelLatestCallDispositionMap.get(c.id) ?? null;
          const binotelLatestCallStartTime = binotelLatestCallStartTimeMap.get(c.id) ?? null;
          return {
            ...c,
            callStatusName: callSt?.name || undefined,
            callStatusBadgeKey: callSt?.badgeKey || undefined,
            callStatusLogs: callLogs.length > 0 ? callLogs : undefined,
            binotelCallsCount: binotelCallsCount > 0 ? binotelCallsCount : undefined,
            binotelLatestCallRecordingUrl: binotelLatestCallRecordingUrl || undefined,
            binotelLatestCallGeneralID: binotelLatestCallGeneralID || undefined,
            binotelLatestCallType: binotelLatestCallType || undefined,
            binotelLatestCallDisposition: binotelLatestCallDisposition || undefined,
            binotelLatestCallStartTime: binotelLatestCallStartTime?.toISOString?.() || (binotelLatestCallStartTime ? String(binotelLatestCallStartTime) : undefined),
          };
        });
      } catch (err) {
        console.warn('[direct/clients] ⚠️ Не вдалося додати метадані статусу дзвінків (не критично):', err);
        return clientsWithChatMeta;
      }
    })();

    // Додаємо похідне поле: daysSinceLastVisit (по днях Europe/Kyiv).
    // UI показує лише число днів.
    const clientsWithDaysSinceLastVisit = (() => {
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
          return clientsWithCallMeta;
        }

        const result = clientsWithCallMeta.map((c) => {
          // «Дні з останнього візиту» = будь-який візит з attended=true (консультація або платна послуга).
          // Оплата не береться до уваги; беремо найновішу з attended-дат, fallback — lastVisitAt.
          const iso = getLastAttendedVisitDate(c);
          if (!iso) {
            return { ...c, daysSinceLastVisit: undefined };
          }
          const day = kyivDayFromISO(iso);
          const idx = toDayIndex(day);

          if (!Number.isFinite(idx)) {
            return { ...c, daysSinceLastVisit: undefined };
          }
          const diff = todayIdx - idx;
          const daysSinceLastVisit = diff < 0 ? 0 : diff;

          return { ...c, daysSinceLastVisit };
        });

        return result;
      } catch (err) {
        console.warn('[direct/clients] ⚠️ Не вдалося порахувати daysSinceLastVisit (не критично):', err);
        return clientsWithCallMeta;
      }
    })();

    // Фільтри колонок (Act, Днів, Inst, Стан, Консультація, Запис, Майстер) — Europe/Kyiv для дат
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

    // Фільтри по колонках (Консультація, Запис, Майстер) об'єднуються за OR: показуємо клієнтів, що підходять під будь-який із них
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
    const hasColumnFilters = hasConsultationFilters || hasRecordFilters || hasMasterFilters;

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

      const consultationPart = hasConsultationFilters ? applyConsultation(base) : [];
      const recordPart = hasRecordFilters ? applyRecord(base) : [];
      const masterPart = hasMasterFilters ? applyMaster(base) : [];
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
      } else {
        // OR: клієнт підходить під будь-який із колонкових фільтрів
        resultIds = new Set<string>();
        for (const c of consultationPart) resultIds.add(c.id);
        for (const c of recordPart) resultIds.add(c.id);
        for (const c of masterPart) resultIds.add(c.id);
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

    // Підрахунок по статусах з усієї відфільтрованої бази (до застосування statusIds)
    const statusCounts: Record<string, number> = {};
    for (const c of filtered) {
      const sid = (c.statusId || '').toString().trim();
      if (sid) statusCounts[sid] = (statusCounts[sid] ?? 0) + 1;
    }

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
      const toDay = (val: unknown): string => {
        if (!val) return '';
        try {
          const d = new Date(val as string | Date);
          return isNaN(d.getTime()) ? '' : kyivDayFromISO(d.toISOString());
        } catch {
          return '';
        }
      };
      const mainDate = c.updatedAt ?? c.createdAt;
      if (mainDate && toDay(mainDate) === todayKyivSort) return true;
      if (c.lastMessageAt && toDay(c.lastMessageAt) === todayKyivSort) return true;
      if (c.consultationBookingDate && toDay(c.consultationBookingDate) === todayKyivSort) return true;
      if (c.paidServiceDate && toDay(c.paidServiceDate) === todayKyivSort) return true;
      if (c.statusSetAt && toDay(c.statusSetAt) === todayKyivSort) return true;
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
          .filter((c) => Array.isArray((c as any).paidServiceMastersBreakdown) && (c as any).paidServiceMastersBreakdown.length > 0)
          .slice(0, 20)
          .map((c) => {
            const bd = (c as any).paidServiceMastersBreakdown as { masterName: string; sumUAH: number }[];
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

    const response: Record<string, unknown> = { 
      ok: true, 
      clients: clientsToReturn,
      totalCount: totalFilteredCount, // Кількість після фільтрів (для пагінації / infinite scroll)
      statusCounts, // Кількість по статусах з усієї бази (для фільтра)
      ...(mainFilterCounts && {
        stateCounts: mainFilterCounts.stateCounts,
        daysCounts: mainFilterCounts.daysCounts,
        instCounts: mainFilterCounts.instCounts,
        binotelCallsFilterCounts: mainFilterCounts.binotelCallsFilterCounts,
        clientTypeCounts: mainFilterCounts.clientTypeCounts,
        consultationCounts: mainFilterCounts.consultationCounts,
        recordCounts: mainFilterCounts.recordCounts,
      }),
      debug: { 
        totalBeforeFilter: clients.length,
        filters: { statusId, masterId, source },
        sortBy,
        sortOrder,
        ...(breakdownSample && { breakdownSample }),
      } 
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
    const existing = await getAllDirectClients();
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