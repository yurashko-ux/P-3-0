// web/lib/altegio/paid-day-api-reconcile.ts
// Звірка платних записів за Kyiv-день: Altegio GET /records (API) ↔ Direct.
// Без full mirror: лише класифікація прогалин і підготовка до догону.

import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';
import {
  fetchAllRecordsForLocation,
  isConsultationService,
  type ClientRecordWithClientId,
} from '@/lib/altegio/records';
import { computeServicesTotalCostUAH, kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { getTodayKyiv } from '@/lib/direct-stats-config';

export type PaidDayGapKind =
  /** У Direct є лінк і поля виглядають узгоджено з API за цей день. */
  | 'ok'
  /** Є Direct + altegioClientId, але дата/attendance/сума неповні або розходяться. */
  | 'incomplete'
  /** У Direct немає клієнта з цим altegioClientId. */
  | 'missing_client'
  /** У Direct є кандидат без altegioClientId (лід) — потрібна прив’язка. */
  | 'unlinked_lead'
  /** Запис Altegio без client_id — не можна зіставити. */
  | 'no_altegio_client_id';

export type PaidDayApiVisit = {
  altegioClientId: number | null;
  clientName: string | null;
  clientPhone: string | null;
  kyivDay: string;
  datetime: string | null;
  recordId: number | null;
  visitId: number | null;
  attendance: number | null;
  costUAH: number;
  staffName: string | null;
  servicesTitles: string[];
};

export type PaidDayReconcileRow = {
  kind: PaidDayGapKind;
  altegio: PaidDayApiVisit;
  direct?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string | null;
    altegioClientId: number | null;
    paidServiceDate: string | null;
    paidServiceKyivDay: string | null;
    paidServiceTotalCost: number | null;
    paidServiceAttended: boolean | null;
    paidServiceAttendanceValue: number | null;
  } | null;
  /** Кандидати на прив’язку (unlinked_lead). */
  linkCandidates?: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string | null;
    phone: string | null;
    matchBy: 'phone' | 'name';
  }>;
  notes: string[];
};

export type PaidDayReconcileResult = {
  kyivDay: string;
  locationId: number;
  altegioPaidVisits: number;
  altegioPaidClients: number;
  directWithPaidDate: number;
  counts: Record<PaidDayGapKind, number>;
  rows: PaidDayReconcileRow[];
  /** Direct з paidServiceDate=день, яких немає серед API paid клієнтів того дня. */
  directExtra: Array<{
    id: string;
    name: string;
    altegioClientId: number | null;
    paidServiceTotalCost: number | null;
    paidServiceAttended: boolean | null;
  }>;
};

function digitsPhone(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D+/g, '');
}

function normalizeNameKey(first?: string | null, last?: string | null, full?: string | null): string {
  const fromParts = [last, first].filter(Boolean).join(' ').trim().toLowerCase();
  const s = (fromParts || String(full || '').trim().toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/[ʼ'`]/g, "'");
  return s;
}

function isPaidNonConsultation(rec: ClientRecordWithClientId): boolean {
  if (rec.deleted) return false;
  const services = Array.isArray(rec.services) ? rec.services : [];
  const { isConsultation } = isConsultationService(services);
  if (!isConsultation) return true;
  // Змішаний запис (консультація + платна) — рахуємо платним, якщо є не-консультаційна послуга.
  return services.some((s) => {
    const title = String(s?.title || s?.name || '').toLowerCase();
    return Boolean(title) && !/консультаці/i.test(title);
  });
}

function recordCostUAH(rec: ClientRecordWithClientId): number {
  const services = Array.isArray(rec.services) ? rec.services : [];
  const fromServices = computeServicesTotalCostUAH(services as any[]);
  if (fromServices > 0) return fromServices;
  // Fallback на поля запису, якщо services без cost.
  const raw = rec as Record<string, unknown>;
  const candidates = [raw.cost, raw.total_cost, raw.totalCost, raw.result_cost, raw.resultCost];
  for (const c of candidates) {
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function toVisit(rec: ClientRecordWithClientId, kyivDay: string): PaidDayApiVisit {
  const services = Array.isArray(rec.services) ? rec.services : [];
  const clientIdRaw = rec.client_id;
  const clientIdNum = clientIdRaw != null ? Number(clientIdRaw) : NaN;
  return {
    altegioClientId: Number.isFinite(clientIdNum) && clientIdNum > 0 ? clientIdNum : null,
    clientName: rec.client_name ?? null,
    clientPhone: rec.client_phone ?? null,
    kyivDay,
    datetime: rec.date,
    recordId: rec.record_id != null ? Number(rec.record_id) : null,
    visitId: rec.visit_id != null ? Number(rec.visit_id) : null,
    attendance: rec.attendance,
    costUAH: recordCostUAH(rec),
    staffName: rec.staff_name ?? null,
    servicesTitles: services
      .map((s) => String(s?.title || s?.name || '').trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

/**
 * Один клієнт за день → один «головний» платний візит:
 * пріоритет attendance=1/2, потім більша сума, потім пізніший datetime.
 */
function pickPrimaryPaidVisit(visits: PaidDayApiVisit[]): PaidDayApiVisit {
  const sorted = [...visits].sort((a, b) => {
    const attScore = (v: PaidDayApiVisit) => (v.attendance === 1 || v.attendance === 2 ? 2 : v.attendance === 0 ? 1 : 0);
    const dAtt = attScore(b) - attScore(a);
    if (dAtt !== 0) return dAtt;
    if (b.costUAH !== a.costUAH) return b.costUAH - a.costUAH;
    const ta = a.datetime ? new Date(a.datetime).getTime() : 0;
    const tb = b.datetime ? new Date(b.datetime).getTime() : 0;
    return tb - ta;
  });
  return sorted[0]!;
}

function directPaidDayIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return kyivDayFromISO(d) || null;
  return kyivDayFromISO(d.toISOString()) || null;
}

export async function reconcilePaidDayFromAltegioApi(options?: {
  kyivDay?: string | null;
  locationId?: number | null;
}): Promise<PaidDayReconcileResult> {
  const kyivDay = getTodayKyiv(options?.kyivDay);
  const locationIdRaw = options?.locationId ?? Number(getEnvValue('ALTEGIO_COMPANY_ID') || '');
  if (!Number.isFinite(locationIdRaw) || locationIdRaw <= 0) {
    throw new Error('ALTEGIO_COMPANY_ID не налаштовано');
  }
  const locationId = locationIdRaw;

  console.log('[paid-day-api-reconcile] Старт звірки', { kyivDay, locationId });

  const rawRecords = await fetchAllRecordsForLocation(locationId, {
    startDate: kyivDay,
    endDate: kyivDay,
    countPerPage: 50,
    delayMs: 200,
  });

  const paidRecords = rawRecords.filter((r) => {
    const day = r.date ? kyivDayFromISO(r.date) : '';
    if (day !== kyivDay) return false;
    return isPaidNonConsultation(r);
  });

  const byClient = new Map<string, PaidDayApiVisit[]>();
  const noClientId: PaidDayApiVisit[] = [];
  for (const rec of paidRecords) {
    const visit = toVisit(rec, kyivDay);
    if (!visit.altegioClientId) {
      noClientId.push(visit);
      continue;
    }
    const key = String(visit.altegioClientId);
    const list = byClient.get(key) ?? [];
    list.push(visit);
    byClient.set(key, list);
  }

  const primaryVisits: PaidDayApiVisit[] = [...byClient.values()].map(pickPrimaryPaidVisit);

  const altegioIds = primaryVisits.map((v) => v.altegioClientId!).filter(Boolean);
  const linkedClients = altegioIds.length
    ? await prisma.directClient.findMany({
        where: { altegioClientId: { in: altegioIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          phone: true,
          altegioClientId: true,
          paidServiceDate: true,
          paidServiceKyivDay: true,
          paidServiceTotalCost: true,
          paidServiceAttended: true,
          paidServiceAttendanceValue: true,
        },
      })
    : [];

  const byAltegioId = new Map<number, (typeof linkedClients)[number]>();
  for (const c of linkedClients) {
    if (c.altegioClientId == null) continue;
    byAltegioId.set(Number(c.altegioClientId), c);
  }

  // Кандидати без лінку — ліди з телефоном/іменем (обмежений набір для матчу).
  const unlinkedPool = await prisma.directClient.findMany({
    where: { altegioClientId: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
      phone: true,
    },
    take: 5000,
  });

  const rows: PaidDayReconcileRow[] = [];

  for (const visit of noClientId) {
    rows.push({
      kind: 'no_altegio_client_id',
      altegio: visit,
      direct: null,
      notes: ['У записі Altegio немає client_id — зіставити з Direct неможливо автоматично'],
    });
  }

  for (const visit of primaryVisits) {
    const notes: string[] = [];
    const linked = byAltegioId.get(visit.altegioClientId!);
    if (!linked) {
      const phoneDigits = digitsPhone(visit.clientPhone);
      const nameKey = normalizeNameKey(null, null, visit.clientName);
      const candidates: NonNullable<PaidDayReconcileRow['linkCandidates']> = [];
      for (const c of unlinkedPool) {
        const cPhone = digitsPhone(c.phone);
        if (phoneDigits && cPhone && (cPhone.endsWith(phoneDigits.slice(-9)) || phoneDigits.endsWith(cPhone.slice(-9)))) {
          candidates.push({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            instagramUsername: c.instagramUsername,
            phone: c.phone,
            matchBy: 'phone',
          });
          continue;
        }
        const cName = normalizeNameKey(c.firstName, c.lastName, null);
        if (nameKey && cName && (cName === nameKey || cName.includes(nameKey) || nameKey.includes(cName))) {
          candidates.push({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            instagramUsername: c.instagramUsername,
            phone: c.phone,
            matchBy: 'name',
          });
        }
      }
      // Унікальний phone-матч важливіший за ім’я.
      const phoneUnique = candidates.filter((c) => c.matchBy === 'phone');
      if (phoneUnique.length === 1 || candidates.length > 0) {
        rows.push({
          kind: 'unlinked_lead',
          altegio: visit,
          direct: null,
          linkCandidates: phoneUnique.length === 1 ? phoneUnique : candidates.slice(0, 5),
          notes: [
            'Немає Direct з цим altegioClientId',
            phoneUnique.length === 1
              ? 'Знайдено унікальний лід по телефону — можна прив’язати'
              : candidates.length
                ? `Кандидатів на лінк: ${candidates.length}`
                : 'Кандидатів на лінк не знайдено',
          ],
        });
      } else {
        rows.push({
          kind: 'missing_client',
          altegio: visit,
          direct: null,
          notes: ['Клієнта немає в Direct — потрібен імпорт з Altegio'],
        });
      }
      continue;
    }

    const paidDay =
      linked.paidServiceKyivDay ||
      directPaidDayIso(linked.paidServiceDate) ||
      null;
    const cost = linked.paidServiceTotalCost;
    const attended = linked.paidServiceAttended;
    const apiArrived = visit.attendance === 1 || visit.attendance === 2;

    const dateOk = paidDay === kyivDay;
    const costOk = typeof cost === 'number' && cost > 0;
    const attendedOk = apiArrived ? attended === true : true;

    if (dateOk && costOk && attendedOk) {
      rows.push({
        kind: 'ok',
        altegio: visit,
        direct: {
          id: linked.id,
          firstName: linked.firstName,
          lastName: linked.lastName,
          instagramUsername: linked.instagramUsername,
          altegioClientId: linked.altegioClientId != null ? Number(linked.altegioClientId) : null,
          paidServiceDate: linked.paidServiceDate?.toISOString?.() ?? (linked.paidServiceDate as any),
          paidServiceKyivDay: paidDay,
          paidServiceTotalCost: cost,
          paidServiceAttended: attended,
          paidServiceAttendanceValue: linked.paidServiceAttendanceValue,
        },
        notes: ['Узгоджено з API'],
      });
      continue;
    }

    if (!dateOk) notes.push(`Direct paidServiceDate день=${paidDay || '—'}, очікували ${kyivDay}`);
    if (!costOk) notes.push(`Direct paidServiceTotalCost=${cost ?? 'null'}, API≈${visit.costUAH}`);
    if (!attendedOk) notes.push(`API attendance=${visit.attendance}, Direct attended=${attended}`);

    rows.push({
      kind: 'incomplete',
      altegio: visit,
      direct: {
        id: linked.id,
        firstName: linked.firstName,
        lastName: linked.lastName,
        instagramUsername: linked.instagramUsername,
        altegioClientId: linked.altegioClientId != null ? Number(linked.altegioClientId) : null,
        paidServiceDate: linked.paidServiceDate?.toISOString?.() ?? (linked.paidServiceDate as any),
        paidServiceKyivDay: paidDay,
        paidServiceTotalCost: cost,
        paidServiceAttended: attended,
        paidServiceAttendanceValue: linked.paidServiceAttendanceValue,
      },
      notes,
    });
  }

  // Direct з датою цього дня, яких немає в API paid-списку (можливий шум / старі дані).
  const apiIdSet = new Set(altegioIds);
  const directOnDay = await prisma.directClient.findMany({
    where: {
      OR: [{ paidServiceKyivDay: kyivDay }, { paidServiceDate: { not: null } }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      altegioClientId: true,
      paidServiceDate: true,
      paidServiceKyivDay: true,
      paidServiceTotalCost: true,
      paidServiceAttended: true,
    },
  });
  const directExtra = directOnDay
    .filter((c) => (c.paidServiceKyivDay || directPaidDayIso(c.paidServiceDate)) === kyivDay)
    .filter((c) => c.altegioClientId == null || !apiIdSet.has(Number(c.altegioClientId)))
    .map((c) => ({
      id: c.id,
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.id,
      altegioClientId: c.altegioClientId != null ? Number(c.altegioClientId) : null,
      paidServiceTotalCost: c.paidServiceTotalCost,
      paidServiceAttended: c.paidServiceAttended,
    }));

  const counts: Record<PaidDayGapKind, number> = {
    ok: 0,
    incomplete: 0,
    missing_client: 0,
    unlinked_lead: 0,
    no_altegio_client_id: 0,
  };
  for (const r of rows) counts[r.kind] += 1;

  const result: PaidDayReconcileResult = {
    kyivDay,
    locationId,
    altegioPaidVisits: paidRecords.length,
    altegioPaidClients: primaryVisits.length,
    directWithPaidDate: directOnDay.filter(
      (c) => (c.paidServiceKyivDay || directPaidDayIso(c.paidServiceDate)) === kyivDay
    ).length,
    counts,
    rows,
    directExtra,
  };

  console.log('[paid-day-api-reconcile] Готово', {
    kyivDay,
    altegioPaidClients: result.altegioPaidClients,
    directWithPaidDate: result.directWithPaidDate,
    counts: result.counts,
    directExtra: result.directExtra.length,
  });

  return result;
}
