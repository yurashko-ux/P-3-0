// Дашборд власника: збір показників лише з таблиць Kresco (жодного виклику API Altegio).
// Бюджет: 10 запитів до БД на одне відкриття для минулого/поточного періоду, 5 — для майбутнього.
//
// Терміни:
//   Виручка — усе надане за період (послуги + товари в чеках візитів цього періоду).
//   Дохід   — виручка мінус собівартість товару й волосся. Волосся: ціна в $ × робочий курс дня продажу.
// Візит відносимо до дня запису в журналі (kyivDay запису), а не до дня створення чека.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, daysBetween, kyivDayStartUtc, kyivToday } from "./period";
import type {
  AccountKind,
  DashboardAccountRow,
  DashboardData,
  DashboardMasterRow,
  DashboardStorageRow,
  DashboardTitleRow,
  DashboardVisitRow,
  VisitStatus,
} from "./types";

const MAX_ROWS = 600;
/** День, коли журнал масово завантажили з Altegio (3741 запис за раз). */
const JOURNAL_IMPORT_DAY = "2026-10-06";

/** Зайняті хвилини без подвійного рахунку: записи одного майстра, що накладаються в часі, зливаємо. */
function mergedMinutes(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of sorted) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return Math.round(total / 60_000);
}

const appointmentSelect = {
  id: true,
  kyivDay: true,
  datetime: true,
  seanceLength: true,
  attendance: true,
  clientName: true,
  clientPhone: true,
  directClientId: true,
  altegioClientId: true,
  altegioStaffId: true,
  staffName: true,
  lines: { select: { title: true, cost: true, amount: true, service: { select: { kind: true } } } },
  goodLines: { select: { title: true, quantity: true, salePrice: true } },
  checkout: {
    select: {
      status: true,
      totalServices: true,
      totalGoods: true,
      paidAmount: true,
      payments: {
        select: {
          amount: true,
          amountFx: true,
          currencyCode: true,
          accountTitle: true,
          paymentKind: true,
          financeAccount: { select: { title: true, kind: true, currencyCode: true } },
        },
      },
      goodLines: {
        select: {
          title: true,
          quantity: true,
          salePrice: true,
          costPerUnit: true,
          product: { select: { isHair: true, costUsd: true } },
        },
      },
    },
  },
} satisfies Prisma.SalonAppointmentSelect;

type AppointmentRow = Prisma.SalonAppointmentGetPayload<{ select: typeof appointmentSelect }>;

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function isConsultation(row: AppointmentRow): boolean {
  if (row.lines.length === 0) return false;
  return row.lines.every((line) => line.service?.kind === "consultation" || /консультац/i.test(line.title));
}

function servicesSum(row: AppointmentRow): number {
  return row.lines.reduce((sum, line) => sum + (Number(line.cost) || 0), 0);
}

function liveCheckout(row: AppointmentRow) {
  return row.checkout && row.checkout.status !== "void" ? row.checkout : null;
}

function visitStatus(row: AppointmentRow, today: string): VisitStatus {
  if (row.attendance === -1) return "no_show";
  if (liveCheckout(row)) return "paid";
  if (row.attendance === 1) return isConsultation(row) && servicesSum(row) === 0 ? "free" : "no_check";
  return row.kyivDay < today ? "unmarked" : "planned";
}

function clientKey(row: AppointmentRow): string {
  if (row.directClientId) return `d:${row.directClientId}`;
  if (row.altegioClientId) return `a:${row.altegioClientId}`;
  return `n:${(row.clientName || "").trim().toLowerCase()}|${row.clientPhone || ""}`;
}

type VisitGroup = {
  id: string;
  day: string;
  startMs: number;
  client: string;
  masters: string[];
  services: string[];
  /** Товар → кількість: частки одного товару від кількох майстрів складаємо. */
  goods: Map<string, number>;
  sum: number;
  payments: Map<string, number>;
  statuses: VisitStatus[];
  hasCheck: boolean;
  isConsultation: boolean;
};

/** Ключ візиту: клієнт + день. Запис без жодних даних клієнта ні з чим не зводимо. */
function visitGroupKey(row: AppointmentRow): string {
  const key = clientKey(row);
  return key === "n:|" ? `r:${row.id}` : `${key}|${row.kyivDay}`;
}

/** Статус зведеного візиту: спершу те, що потребує уваги (без чека, не відмічено). */
const STATUS_PRIORITY: VisitStatus[] = ["no_check", "unmarked", "paid", "free", "planned", "no_show"];
function groupStatus(statuses: VisitStatus[]): VisitStatus {
  return STATUS_PRIORITY.find((status) => statuses.includes(status)) || "unmarked";
}

/** Сума візиту: з чека, а поки чека немає — послуги плюс товари з запису. */
function visitSum(row: AppointmentRow): number {
  const checkout = liveCheckout(row);
  if (checkout) return (Number(checkout.totalServices) || 0) + (Number(checkout.totalGoods) || 0);
  const goods = row.goodLines.reduce((sum, g) => sum + (Number(g.salePrice) || 0) * (Number(g.quantity) || 0), 0);
  return servicesSum(row) + goods;
}

type PaymentRow = NonNullable<AppointmentRow["checkout"]>["payments"][number];

/** Куди пішла оплата. Імпортовані з Altegio оплати часто без рахунку — це «unknown», а не банк. */
function classifyPayment(p: PaymentRow): { title: string; kind: AccountKind; currency: string } {
  if (p.paymentKind === "deposit") return { title: "Із завдатку", kind: "deposit", currency: "UAH" };
  if (p.financeAccount) {
    return {
      title: p.financeAccount.title,
      kind: p.financeAccount.kind === "cash" ? "cash" : "bank",
      currency: p.currencyCode || p.financeAccount.currencyCode || "UAH",
    };
  }
  const title = (p.accountTitle || "").trim();
  if (!title || /^altegio$/i.test(title)) return { title: "Рахунок не вказано", kind: "unknown", currency: "UAH" };
  const currency = p.currencyCode || (/долар|\$|usd/i.test(title) ? "USD" : /євро|€|eur/i.test(title) ? "EUR" : "UAH");
  const isCash = currency !== "UAH" || /каса|готів/i.test(title);
  return { title, kind: isCash ? "cash" : "bank", currency };
}

function kyivTime(date: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function addTitle(map: Map<string, DashboardTitleRow>, title: string, count: number, sum: number) {
  const key = title.trim() || "Без назви";
  const row = map.get(key) || { title: key, count: 0, sum: 0 };
  row.count += count;
  row.sum += sum;
  map.set(key, row);
}

function sortedTitles(map: Map<string, DashboardTitleRow>): DashboardTitleRow[] {
  return [...map.values()]
    .map((row) => ({ ...row, count: money(row.count), sum: money(row.sum) }))
    .sort((a, b) => b.sum - a.sum || b.count - a.count);
}

function slotMinutes(slots: unknown): number {
  if (!Array.isArray(slots)) return 0;
  let total = 0;
  for (const slot of slots) {
    const from = /^(\d{1,2}):(\d{2})/.exec(String(slot?.from || ""));
    const to = /^(\d{1,2}):(\d{2})/.exec(String(slot?.to || ""));
    if (!from || !to) continue;
    const minutes = Number(to[1]) * 60 + Number(to[2]) - (Number(from[1]) * 60 + Number(from[2]));
    if (minutes > 0) total += minutes;
  }
  return total;
}

type FxRow = { kyivDay: string; usdWorking: number; eurWorking: number };

/** Курс дня продажу; якщо на цей день курс не зафіксовано — найближчий раніший, далі найсвіжіший. */
function usdRateFor(day: string, rates: FxRow[]): number | null {
  if (rates.length === 0) return null;
  const earlier = rates.find((r) => r.kyivDay <= day);
  return (earlier || rates[rates.length - 1]).usdWorking || null;
}

type StorageSqlRow = {
  title: string;
  positions: number;
  book_uah: number;
  hair_usd: number;
  non_usd_uah: number;
  sale_uah: number;
  missing_cost: number;
};

type ChatSqlRow = { grp: string; people: number; answered: number };
type FunnelSqlRow = { new_leads: number; consult_booked: number; consult_done: number; paid_booked: number };

export async function loadDashboard(from: string, to: string): Promise<DashboardData> {
  const startedAt = Date.now();
  const today = kyivToday();
  const isFuture = from > today;
  const includesToday = from <= today && today <= to;
  const fromUtc = kyivDayStartUtc(from);
  const toUtc = kyivDayStartUtc(addDays(to, 1));
  const importDayStart = kyivDayStartUtc(JOURNAL_IMPORT_DAY);
  const importDayEnd = kyivDayStartUtc(addDays(JOURNAL_IMPORT_DAY, 1));
  // Курси потрібні на кожен день продажу в періоді плюс запас на вихідні без зафіксованого курсу.
  const fxTake = isFuture ? 1 : Math.min(120, daysBetween(from, today) + 10);

  const [appointments, depositBalance, storages, fxRates, workDays] = await Promise.all([
    // 1. Записи періоду і сьогоднішні (для блоку «Сьогодні») одним запитом.
    prisma.salonAppointment.findMany({
      where: {
        status: { not: "deleted" },
        OR: [{ kyivDay: { gte: from, lte: to } }, { kyivDay: today }],
      },
      orderBy: { datetime: "asc" },
      select: appointmentSelect,
    }),
    // 2. Баланс завдатків зараз.
    prisma.clientDepositAccount.aggregate({
      where: { isActive: true, balance: { gt: 0 } },
      _sum: { balance: true },
      _count: { _all: true },
    }),
    // 3. Залишки складів зараз.
    prisma.$queryRaw<StorageSqlRow[]>`
      SELECT s.title,
        count(*) FILTER (WHERE st.quantity > 0)::int AS positions,
        coalesce(sum(st.quantity * (CASE WHEN st."costPerUnit" > 0 THEN st."costPerUnit" ELSE p."costPerUnit" END))
          FILTER (WHERE st.quantity > 0), 0)::float AS book_uah,
        coalesce(sum(st.quantity * p."costUsd")
          FILTER (WHERE st.quantity > 0 AND p."isHair" AND p."costUsd" > 0), 0)::float AS hair_usd,
        coalesce(sum(st.quantity * (CASE WHEN st."costPerUnit" > 0 THEN st."costPerUnit" ELSE p."costPerUnit" END))
          FILTER (WHERE st.quantity > 0 AND NOT (p."isHair" AND p."costUsd" > 0)), 0)::float AS non_usd_uah,
        coalesce(sum(st.quantity * p."salePrice") FILTER (WHERE st.quantity > 0), 0)::float AS sale_uah,
        count(*) FILTER (WHERE st.quantity > 0 AND NOT (st."costPerUnit" > 0 OR p."costPerUnit" > 0))::int AS missing_cost
      FROM warehouse_storages s
      LEFT JOIN warehouse_stocks st ON st."storageId" = s.id
      LEFT JOIN warehouse_products p ON p.id = st."productId"
      WHERE s."isActive"
      GROUP BY s.id, s.title
    `,
    // 4. Робочі курси (найсвіжіші зверху).
    prisma.dailyFxRate.findMany({
      where: { kyivDay: { lte: today } },
      orderBy: { kyivDay: "desc" },
      take: fxTake,
      select: { kyivDay: true, usdWorking: true, eurWorking: true },
    }),
    // 5. Графік змін на період — для завантаженості майстрів.
    prisma.teamWorkDay.findMany({
      where: { kyivDay: { gte: from, lte: to } },
      select: { altegioStaffId: true, slots: true },
    }),
  ]);

  // Те, що вже сталося: для майбутнього періоду цих даних не існує — запитів не робимо.
  const past = isFuture
    ? null
    : await Promise.all([
        // 6. Рух завдатків за період.
        prisma.clientDepositLedgerEntry.groupBy({
          by: ["kind"],
          where: { kyivDay: { gte: from, lte: to }, kind: { in: ["topup", "spend"] } },
          _sum: { amount: true },
        }),
        // 7. Записи, створені за період (робота адміністратора).
        prisma.salonAppointment.findMany({
          where: {
            createdAt: { gte: fromUtc, lt: toUtc },
            status: { not: "deleted" },
            // День масового завантаження журналу: createdAt цих рядків — час імпорту, а не робота адміністратора.
            NOT: { createdAt: { gte: importDayStart, lt: importDayEnd } },
          },
          select: { lines: { select: { title: true, service: { select: { kind: true } } } } },
        }),
        // 8. Дзвінки Binotel.
        prisma.directClientBinotelCall.groupBy({
          by: ["callType", "disposition"],
          where: { startTime: { gte: fromUtc, lt: toUtc } },
          _count: { _all: true },
        }),
        // 9. Переписки: рахуємо людьми, окремо ліди й клієнти. Лід — картка, якої ще немає в базі клієнтів салону.
        prisma.$queryRaw<ChatSqlRow[]>`
          SELECT CASE WHEN c."altegioClientId" IS NULL THEN 'lead' ELSE 'client' END AS grp,
            count(DISTINCT m."clientId")::int AS people,
            (count(DISTINCT m."clientId") FILTER (WHERE m.direction = 'outgoing'))::int AS answered
          FROM direct_messages m
          JOIN direct_clients c ON c.id = m."clientId"
          WHERE m."receivedAt" >= ${fromUtc} AND m."receivedAt" < ${toUtc}
          GROUP BY 1
        `,
        // 10. Шлях до клієнта.
        prisma.$queryRaw<FunnelSqlRow[]>`
          SELECT
            (count(*) FILTER (WHERE "firstContactDate" >= ${fromUtc} AND "firstContactDate" < ${toUtc}
              AND "includeInNewLeadsKpi"))::int AS new_leads,
            (count(*) FILTER (WHERE "consultationRecordCreatedAt" >= ${fromUtc}
              AND "consultationRecordCreatedAt" < ${toUtc}))::int AS consult_booked,
            (count(*) FILTER (WHERE "consultationBookingKyivDay" >= ${from} AND "consultationBookingKyivDay" <= ${to}
              AND "consultationAttended" = true))::int AS consult_done,
            (count(*) FILTER (WHERE "paidServiceRecordCreatedAt" >= ${fromUtc}
              AND "paidServiceRecordCreatedAt" < ${toUtc}))::int AS paid_booked
          FROM direct_clients
          WHERE ("firstContactDate" >= ${fromUtc} AND "firstContactDate" < ${toUtc})
            OR ("consultationRecordCreatedAt" >= ${fromUtc} AND "consultationRecordCreatedAt" < ${toUtc})
            OR ("consultationBookingKyivDay" >= ${from} AND "consultationBookingKyivDay" <= ${to})
            OR ("paidServiceRecordCreatedAt" >= ${fromUtc} AND "paidServiceRecordCreatedAt" < ${toUtc})
        `,
      ]);

  const inPeriod = appointments.filter((row) => row.kyivDay >= from && row.kyivDay <= to);
  const todayRows = appointments.filter((row) => row.kyivDay === today);

  // ── Візити, виручка, оплати, дохід ─────────────────────────────────────────
  const visits = { total: 0, clients: 0, paid: 0, free: 0, noCheck: 0, noShow: 0, planned: 0, unmarked: 0 };
  const visitClients = new Set<string>();
  const paidClients = new Set<string>();
  const plannedClients = new Set<string>();
  let revenueServices = 0;
  let revenueGoods = 0;
  let checks = 0;
  let paidCash = 0;
  let paidBank = 0;
  let paidDeposit = 0;
  let paidUnknown = 0;
  let debt = 0;
  let goodsCost = 0;
  let hairCost = 0;
  let missingCostLines = 0;
  let plannedSum = 0;
  const accountMap = new Map<string, DashboardAccountRow>();
  const doneServices = new Map<string, DashboardTitleRow>();
  const plannedServices = new Map<string, DashboardTitleRow>();
  const goodsMap = new Map<string, DashboardTitleRow>();
  const masterMap = new Map<string, DashboardMasterRow & { staffIds: Set<number>; intervals: [number, number][] }>();
  // Візит = один прихід клієнта за день: записи до кількох майстрів зводимо в один рядок.
  const visitGroups = new Map<string, VisitGroup>();

  for (const row of inPeriod) {
    const status = visitStatus(row, today);
    const key = clientKey(row);
    const checkout = liveCheckout(row);
    const sum = visitSum(row);
    visitClients.add(key);

    const groupKey = visitGroupKey(row);
    let group = visitGroups.get(groupKey);
    if (!group) {
      group = {
        id: row.id,
        day: row.kyivDay,
        startMs: row.datetime.getTime(),
        client: (row.clientName || "").trim() || "Без імені",
        masters: [],
        services: [],
        goods: new Map<string, number>(),
        sum: 0,
        payments: new Map<string, number>(),
        statuses: [],
        hasCheck: false,
        isConsultation: true,
      };
      visitGroups.set(groupKey, group);
    }
    if (checkout) {
      checks += 1;
      paidClients.add(key);
      revenueServices += Number(checkout.totalServices) || 0;
      revenueGoods += Number(checkout.totalGoods) || 0;
      let paidHere = 0;
      const byTitle = new Map<string, number>();
      for (const p of checkout.payments) {
        const amount = Number(p.amount) || 0;
        const account = classifyPayment(p);
        paidHere += amount;
        if (account.kind === "cash") paidCash += amount;
        else if (account.kind === "bank") paidBank += amount;
        else if (account.kind === "deposit") paidDeposit += amount;
        else paidUnknown += amount;
        const accKey = `${account.kind}|${account.title}`;
        const acc = accountMap.get(accKey) || { ...account, amountUah: 0, amountFx: null };
        acc.amountUah += amount;
        if (account.currency !== "UAH" && p.amountFx != null) acc.amountFx = (acc.amountFx || 0) + Number(p.amountFx);
        accountMap.set(accKey, acc);
        byTitle.set(account.title, (byTitle.get(account.title) || 0) + amount);
      }
      for (const [title, amount] of byTitle) group.payments.set(title, (group.payments.get(title) || 0) + amount);
      group.hasCheck = true;
      if (sum - paidHere > 0.5) debt += sum - paidHere;

      for (const g of checkout.goodLines) {
        const quantity = Number(g.quantity) || 0;
        addTitle(goodsMap, g.title, quantity, quantity * (Number(g.salePrice) || 0));
        const usd = g.product?.isHair ? Number(g.product.costUsd) || 0 : 0;
        const rate = usd > 0 ? usdRateFor(row.kyivDay, fxRates) : null;
        if (usd > 0 && rate) hairCost += quantity * usd * rate;
        else if (g.costPerUnit != null && g.costPerUnit > 0) {
          if (g.product?.isHair) hairCost += quantity * g.costPerUnit;
          else goodsCost += quantity * g.costPerUnit;
        } else missingCostLines += 1;
      }
    }

    const provided = status === "paid" || status === "free" || status === "no_check";
    if (provided || status === "planned") {
      const target = provided ? doneServices : plannedServices;
      for (const line of row.lines) addTitle(target, line.title, Number(line.amount) || 1, Number(line.cost) || 0);
    }
    if (status === "planned") {
      plannedClients.add(key);
      plannedSum += servicesSum(row);
    }

    if (status !== "no_show") {
      const name = (row.staffName || "").trim() || "Без майстра";
      let master = masterMap.get(name);
      if (!master) {
        master = {
          name,
          visits: 0,
          sum: 0,
          bookedMin: 0,
          shiftMin: 0,
          load: null,
          staffIds: new Set<number>(),
          intervals: [],
        };
        masterMap.set(name, master);
      }
      master.visits += 1;
      master.sum += checkout ? Number(checkout.totalServices) || 0 : servicesSum(row);
      const startMs = row.datetime.getTime();
      master.intervals.push([startMs, startMs + (Number(row.seanceLength) || 0) * 1000]);
      if (row.altegioStaffId) master.staffIds.add(row.altegioStaffId);
    }

    group.startMs = Math.min(group.startMs, row.datetime.getTime());
    const masterName = (row.staffName || "").trim();
    if (masterName && !group.masters.includes(masterName)) group.masters.push(masterName);
    for (const line of row.lines) if (!group.services.includes(line.title)) group.services.push(line.title);
    for (const g of checkout ? checkout.goodLines : row.goodLines) {
      group.goods.set(g.title, (group.goods.get(g.title) || 0) + (Number(g.quantity) || 0));
    }
    group.sum += sum;
    group.statuses.push(status);
    if (!isConsultation(row)) group.isConsultation = false;
  }

  let paidVisits = 0;
  const allRows: DashboardVisitRow[] = [];
  for (const group of visitGroups.values()) {
    const status = groupStatus(group.statuses);
    visits.total += 1;
    if (status === "paid") visits.paid += 1;
    else if (status === "free") visits.free += 1;
    else if (status === "no_check") visits.noCheck += 1;
    else if (status === "no_show") visits.noShow += 1;
    else if (status === "planned") visits.planned += 1;
    else visits.unmarked += 1;
    if (group.hasCheck) paidVisits += 1;
    allRows.push({
      id: group.id,
      day: group.day,
      time: kyivTime(new Date(group.startMs)),
      client: group.client,
      master: group.masters.join(", ") || "—",
      services: group.services,
      goods: [...group.goods].map(([title, raw]) => {
        // 0.33 + 0.33 + 0.33 — це одна ціла одиниця, поділена між майстрами.
        const quantity = Math.abs(raw - Math.round(raw)) < 0.02 ? Math.round(raw) : money(raw);
        return quantity === 1 ? title : `${title} × ${quantity}`;
      }),
      sum: money(group.sum),
      payments: [...group.payments].map(([title, amount]) => `${title}: ${Math.round(amount)}`),
      status,
      isConsultation: group.isConsultation,
    });
  }
  allRows.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));
  const rows = allRows.slice(0, MAX_ROWS);

  // Завантаженість: записані хвилини / хвилини зміни за графіком.
  const shiftByStaff = new Map<number, number>();
  for (const day of workDays) {
    shiftByStaff.set(day.altegioStaffId, (shiftByStaff.get(day.altegioStaffId) || 0) + slotMinutes(day.slots));
  }
  const masters: DashboardMasterRow[] = [...masterMap.values()]
    .map(({ staffIds, intervals, ...master }) => {
      const bookedMin = mergedMinutes(intervals);
      let shiftMin = 0;
      for (const id of staffIds) shiftMin += shiftByStaff.get(id) || 0;
      return {
        ...master,
        sum: money(master.sum),
        bookedMin,
        shiftMin,
        load: shiftMin > 0 ? bookedMin / shiftMin : null,
      };
    })
    .sort((a, b) => b.sum - a.sum || b.visits - a.visits);

  // ── Сьогодні (завжди про сьогодні, незалежно від обраного періоду) ─────────
  const todayBlock = {
    total: 0,
    paid: { count: 0, sum: 0 },
    inSalon: { count: 0, sum: 0 },
    waiting: { count: 0, sum: 0 },
    noShow: 0,
  };
  const todayGroups = new Map<string, { statuses: VisitStatus[]; sum: number }>();
  for (const row of todayRows) {
    const groupKey = visitGroupKey(row);
    const group = todayGroups.get(groupKey) || { statuses: [], sum: 0 };
    group.statuses.push(visitStatus(row, today));
    group.sum += visitSum(row);
    todayGroups.set(groupKey, group);
  }
  for (const group of todayGroups.values()) {
    const status = groupStatus(group.statuses);
    const sum = group.sum;
    todayBlock.total += 1;
    if (status === "no_show") todayBlock.noShow += 1;
    else if (status === "paid" || status === "free") {
      todayBlock.paid.count += 1;
      todayBlock.paid.sum += sum;
    } else if (status === "no_check") {
      todayBlock.inSalon.count += 1;
      todayBlock.inSalon.sum += sum;
    } else {
      todayBlock.waiting.count += 1;
      todayBlock.waiting.sum += sum;
    }
  }

  // ── Склад ──────────────────────────────────────────────────────────────────
  const latestFx = fxRates[0] || null;
  const usdNow = latestFx?.usdWorking || null;
  const storageRows: DashboardStorageRow[] = storages
    .filter((s) => s.positions > 0)
    .map((s) => {
      const hasUsd = s.hair_usd > 0 && usdNow != null;
      return {
        title: s.title,
        valueUah: money(hasUsd ? s.hair_usd * (usdNow as number) + s.non_usd_uah : s.book_uah),
        valueUsd: s.hair_usd > 0 ? money(s.hair_usd) : null,
        saleUah: money(s.sale_uah),
        positions: s.positions,
        missingCost: s.missing_cost,
      };
    })
    .sort((a, b) => b.valueUah - a.valueUah);
  const warehouseUah = storageRows.reduce((sum, s) => sum + s.valueUah, 0);

  // ── Завдатки, робота адміністратора, шлях до клієнта ───────────────────────
  let topup = 0;
  let spend = 0;
  let admin: DashboardData["admin"] = null;
  let funnel: DashboardData["funnel"] = null;
  if (past) {
    const [ledger, created, calls, chats, funnelRows] = past;
    for (const entry of ledger) {
      const amount = Math.abs(Number(entry._sum.amount) || 0);
      if (entry.kind === "topup") topup = amount;
      if (entry.kind === "spend") spend = amount;
    }
    const createdConsultations = created.filter(
      (row) =>
        row.lines.length > 0 &&
        row.lines.every((line) => line.service?.kind === "consultation" || /консультац/i.test(line.title)),
    ).length;
    const callStats = { incoming: 0, outgoing: 0, missed: 0 };
    for (const call of calls) {
      const count = call._count._all;
      const answered = String(call.disposition || "").toUpperCase() === "ANSWER";
      if (call.callType === "outgoing") callStats.outgoing += count;
      else if (answered) callStats.incoming += count;
      else callStats.missed += count;
    }
    const chatOf = (grp: string) => chats.find((row) => row.grp === grp) || { people: 0, answered: 0 };
    admin = {
      created: {
        total: created.length,
        consultations: createdConsultations,
        paid: created.length - createdConsultations,
      },
      calls: callStats,
      chats: {
        clients: chatOf("client").people,
        leads: chatOf("lead").people,
        clientsAnswered: chatOf("client").answered,
        leadsAnswered: chatOf("lead").answered,
      },
    };
    const f = funnelRows[0];
    funnel = {
      newLeads: f?.new_leads || 0,
      leadsInChat: chatOf("lead").people,
      consultBooked: f?.consult_booked || 0,
      consultDone: f?.consult_done || 0,
      paidBooked: f?.paid_booked || 0,
    };
  }

  const revenueTotal = revenueServices + revenueGoods;
  const paidTotal = paidCash + paidBank + paidDeposit + paidUnknown;
  const accounts = [...accountMap.values()]
    .map((a) => ({ ...a, amountUah: money(a.amountUah), amountFx: a.amountFx == null ? null : money(a.amountFx) }))
    .sort((a, b) => b.amountUah - a.amountUah);

  console.log(
    `[dashboard] ${from}…${to}: записів ${inPeriod.length}, чеків ${checks}, виручка ${money(revenueTotal)}, ` +
      `оплачено ${money(paidTotal)} (без рахунку ${money(paidUnknown)}), запитів ${past ? 10 : 5}, ${Date.now() - startedAt} мс`,
  );

  return {
    ok: true,
    period: { from, to, days: daysBetween(from, to), today, isFuture, includesToday },
    fx: { usd: usdNow, eur: latestFx?.eurWorking || null, day: latestFx?.kyivDay || null },
    revenue: {
      total: money(revenueTotal),
      services: money(revenueServices),
      goods: money(revenueGoods),
      clients: paidClients.size,
      checks,
      avgCheck: paidVisits > 0 ? money(revenueTotal / paidVisits) : null,
    },
    paid: {
      total: money(paidTotal),
      cash: money(paidCash),
      bank: money(paidBank),
      deposit: money(paidDeposit),
      unknown: money(paidUnknown),
      debt: money(debt),
    },
    accounts,
    income: {
      total: money(revenueTotal - goodsCost - hairCost),
      goodsCost: money(goodsCost),
      hairCost: money(hairCost),
      missingCostLines,
    },
    visits: { ...visits, clients: visitClients.size },
    planned: { count: visits.planned, clients: plannedClients.size, servicesSum: money(plannedSum) },
    servicesDone: sortedTitles(doneServices),
    servicesPlanned: sortedTitles(plannedServices),
    goods: sortedTitles(goodsMap),
    masters,
    today: {
      total: todayBlock.total,
      paid: { count: todayBlock.paid.count, sum: money(todayBlock.paid.sum) },
      inSalon: { count: todayBlock.inSalon.count, sum: money(todayBlock.inSalon.sum) },
      waiting: { count: todayBlock.waiting.count, sum: money(todayBlock.waiting.sum) },
      noShow: todayBlock.noShow,
    },
    deposits: {
      balance: money(Number(depositBalance._sum.balance) || 0),
      accounts: depositBalance._count._all,
      topup: money(topup),
      spend: money(spend),
    },
    warehouse: {
      totalUah: money(warehouseUah),
      totalUsd: usdNow ? money(warehouseUah / usdNow) : null,
      storages: storageRows,
    },
    funnel,
    admin,
    rows,
    rowsTruncated: allRows.length > rows.length,
  };
}
