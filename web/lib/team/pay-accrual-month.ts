// Нарахування ЗП за місяць з чеків Kresco (не з payroll Altegio).
// Кожен виконавець рядка отримує повну суму рядка, далі свій % за схемами.
// Оклад за місяць / фіксована сума / фікс міксу — один раз 1-го числа.
// Мін. гарантію не нараховуємо.

import { prisma } from "@/lib/prisma";
import { parseStaffIdsJson } from "@/lib/journal/line-staff";
import { calculatePayAccrual, type PayPeriodBases, type PaySchemeLike } from "@/lib/team/pay-scheme-calc";

export type PayrollSchemePart = {
  schemeId: string;
  title: string;
  amountUah: number;
  breakdown: string;
};

export type PayrollCell = {
  amountUah: number;
  servicesUah: number;
  goodsUah: number;
  hairSalesUah: number;
  worked: boolean;
  parts: PayrollSchemePart[];
};

export type PayrollPerson = {
  id: string;
  name: string;
};

export type PayrollMonth = {
  month: string;
  days: string[];
  people: PayrollPerson[];
  cells: Record<string, Record<string, PayrollCell>>;
  /** Наростаючий підсумок салону на кінець дня. */
  running: Record<string, number>;
  totals: Record<string, number>;
  monthTotalUah: number;
};

type SchemeRow = PaySchemeLike & { id: string; title: string };

type DayBase = {
  servicesUah: number;
  goodsUah: number;
  hairSalesUah: number;
  worked: boolean;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function paramsOf(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

export function daysOfMonth(month: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const year = Number(match[1]);
  const mon = Number(match[2]);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days: string[] = [];
  for (let d = 1; d <= last; d++) {
    days.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

function emptyBase(): DayBase {
  return { servicesUah: 0, goodsUah: 0, hairSalesUah: 0, worked: false };
}

/** Денна клітинка: змінні % і оклад за день. Фікс місяця — лише якщо isMonthStart. */
export function accruePersonDay(input: {
  isMonthStart: boolean;
  schemes: SchemeRow[];
  bases: PayPeriodBases;
  worked: boolean;
}): { amountUah: number; parts: PayrollSchemePart[] } {
  const parts: PayrollSchemePart[] = [];
  const bases = input.bases;
  const zero: PayPeriodBases = { servicesUah: 0, goodsUah: 0, hairSalesUah: 0, workDays: 0 };

  const push = (scheme: SchemeRow, accrued: { amountUah: number; breakdown: string }) => {
    const amountUah = money(accrued.amountUah);
    if (amountUah === 0) return;
    parts.push({
      schemeId: scheme.id,
      title: scheme.title,
      amountUah,
      breakdown: accrued.breakdown,
    });
  };

  for (const scheme of input.schemes) {
    switch (scheme.kind) {
      case "fixed_month":
      case "fixed_amount":
        if (input.isMonthStart) push(scheme, calculatePayAccrual(scheme, zero));
        break;
      case "fixed_day":
        if (input.worked) push(scheme, calculatePayAccrual(scheme, { ...zero, workDays: 1 }));
        break;
      case "pct_services":
      case "pct_turnover":
      case "pct_hair":
      case "pct_goods":
        push(scheme, calculatePayAccrual(scheme, bases));
        break;
      case "mix": {
        if (input.isMonthStart) {
          push(scheme, calculatePayAccrual({ kind: "fixed_month", params: scheme.params }, zero));
        }
        push(scheme, calculatePayAccrual({ kind: "pct_services", params: scheme.params }, bases));
        break;
      }
      case "min_guarantee":
        break;
      default:
        break;
    }
  }

  const amountUah = money(parts.reduce((sum, part) => sum + part.amountUah, 0));
  return { amountUah, parts };
}

function staffOrParticipants(staffIdsJson: string | null | undefined, participantIds: number[]): number[] {
  const explicit = parseStaffIdsJson(staffIdsJson);
  const ids = explicit.length > 0 ? explicit : participantIds;
  return [...new Set(ids.filter((id) => id > 0))];
}

export async function buildPayrollMonth(month: string): Promise<PayrollMonth> {
  const days = daysOfMonth(month);
  if (days.length === 0) throw new Error("Місяць має бути у форматі YYYY-MM");
  const monthStart = days[0];
  const monthEnd = days[days.length - 1];

  const members = await prisma.teamMember.findMany({
    where: { hiddenAt: null },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      payScheme: true,
      schemeLinks: {
        orderBy: { sortOrder: "asc" },
        include: { scheme: true },
      },
    },
  });

  const people: PayrollPerson[] = members.map((m) => ({ id: m.id, name: m.name }));
  const schemesByMember = new Map<string, SchemeRow[]>();
  const memberByStaff = new Map<number, string>();

  for (const member of members) {
    const fromLinks = member.schemeLinks
      .map((link) => link.scheme)
      .filter(Boolean)
      .map((scheme) => ({
        id: scheme.id,
        title: scheme.title,
        kind: scheme.kind,
        params: paramsOf(scheme.params),
      }));
    const schemes =
      fromLinks.length > 0
        ? fromLinks
        : member.payScheme
          ? [
              {
                id: member.payScheme.id,
                title: member.payScheme.title,
                kind: member.payScheme.kind,
                params: paramsOf(member.payScheme.params),
              },
            ]
          : [];
    schemesByMember.set(member.id, schemes);
    if (member.altegioStaffId != null && member.altegioStaffId > 0) {
      memberByStaff.set(member.altegioStaffId, member.id);
    }
  }

  const checkouts = await prisma.salonCheckout.findMany({
    where: {
      kyivDay: { gte: monthStart, lte: monthEnd },
      status: { not: "void" },
    },
    select: {
      id: true,
      kyivDay: true,
      goodLines: {
        select: {
          productId: true,
          salePrice: true,
          quantity: true,
          product: { select: { isHair: true } },
        },
      },
      appointment: {
        select: {
          lines: { select: { cost: true, staffIdsJson: true } },
          participants: { select: { altegioStaffId: true } },
          goodLines: { select: { productId: true, staffIdsJson: true } },
        },
      },
    },
  });

  const bases = new Map<string, DayBase>();
  const keyOf = (day: string, memberId: string) => `${day}|${memberId}`;
  const bucket = (day: string, memberId: string): DayBase => {
    const key = keyOf(day, memberId);
    let row = bases.get(key);
    if (!row) {
      row = emptyBase();
      bases.set(key, row);
    }
    return row;
  };

  let skippedStaff = 0;
  const credit = (day: string, staffIds: number[], add: (row: DayBase) => void) => {
    const seen = new Set<string>();
    for (const staffId of staffIds) {
      const memberId = memberByStaff.get(staffId);
      if (!memberId) {
        skippedStaff += 1;
        continue;
      }
      if (seen.has(memberId)) continue;
      seen.add(memberId);
      const row = bucket(day, memberId);
      row.worked = true;
      add(row);
    }
  };

  for (const checkout of checkouts) {
    const day = checkout.kyivDay;
    if (!day.startsWith(month)) continue;
    const appointment = checkout.appointment;
    const participantIds = (appointment?.participants || [])
      .map((p) => p.altegioStaffId)
      .filter((id) => id > 0);

    for (const line of appointment?.lines || []) {
      const amount = money(line.cost);
      const staff = staffOrParticipants(line.staffIdsJson, participantIds);
      credit(day, staff, (row) => {
        row.servicesUah = money(row.servicesUah + amount);
      });
    }

    const goodStaffByProduct = new Map<string, number[]>();
    for (const good of appointment?.goodLines || []) {
      const explicit = parseStaffIdsJson(good.staffIdsJson);
      const prev = goodStaffByProduct.get(good.productId) || [];
      if (explicit.length > 0) {
        goodStaffByProduct.set(good.productId, [...prev, ...explicit]);
      } else if (!goodStaffByProduct.has(good.productId)) {
        goodStaffByProduct.set(good.productId, []);
      }
    }

    for (const good of checkout.goodLines) {
      const amount = money((Number(good.salePrice) || 0) * (Number(good.quantity) || 0));
      const listed = goodStaffByProduct.get(good.productId);
      const staff =
        listed && listed.length > 0 ? [...new Set(listed)] : participantIds;
      const isHair = Boolean(good.product?.isHair);
      credit(day, staff, (row) => {
        row.goodsUah = money(row.goodsUah + amount);
        if (isHair) row.hairSalesUah = money(row.hairSalesUah + amount);
      });
    }
  }

  const cells: Record<string, Record<string, PayrollCell>> = {};
  const running: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const person of people) totals[person.id] = 0;
  let cursor = 0;

  for (const day of days) {
    const isMonthStart = day === monthStart;
    const row: Record<string, PayrollCell> = {};
    let daySum = 0;
    for (const person of people) {
      const base = bases.get(keyOf(day, person.id)) || emptyBase();
      const accrued = accruePersonDay({
        isMonthStart,
        schemes: schemesByMember.get(person.id) || [],
        worked: base.worked,
        bases: {
          servicesUah: base.servicesUah,
          goodsUah: base.goodsUah,
          hairSalesUah: base.hairSalesUah,
          workDays: base.worked ? 1 : 0,
        },
      });
      row[person.id] = {
        amountUah: accrued.amountUah,
        servicesUah: base.servicesUah,
        goodsUah: base.goodsUah,
        hairSalesUah: base.hairSalesUah,
        worked: base.worked,
        parts: accrued.parts,
      };
      daySum = money(daySum + accrued.amountUah);
      totals[person.id] = money(totals[person.id] + accrued.amountUah);
    }
    cells[day] = row;
    cursor = money(cursor + daySum);
    running[day] = cursor;
  }

  const monthTotalUah = money(people.reduce((sum, person) => sum + (totals[person.id] || 0), 0));
  console.log(
    `[team/payroll] ${month} чеків=${checkouts.length} людей=${people.length} сума=${monthTotalUah} пропущено чужих staff=${skippedStaff}`,
  );

  return { month, days, people, cells, running, totals, monthTotalUah };
}
