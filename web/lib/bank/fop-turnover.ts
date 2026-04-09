// web/lib/bank/fop-turnover.ts
// Оборот ФОП: надходження (amount > 0) з виписки Monobank; місячний з урахуванням ручного значення на дату відліку.

import { prisma } from "@/lib/prisma";

export function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function utcYearStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

/** Кінець календарного дня UTC для дати відліку (00:00 UTC того ж дня в БД). */
export function endOfUtcCalendarDay(anchorStart: Date): Date {
  const y = anchorStart.getUTCFullYear();
  const m = anchorStart.getUTCMonth();
  const day = anchorStart.getUTCDate();
  return new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
}

/**
 * 00:00 UTC наступного календарного дня після дня дати знімка YTD.
 * Усі вхідні платежі «з 09.04» = time >= цього моменту (після знімка на 08.04 кінець дня UTC).
 */
export function startOfNextUtcCalendarDayAfterManualDate(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
}

function sameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** Накопичена сума надходжень (amount > 0) по ланцюжку до моменту t включно. */
function incomingCumThroughTime(
  chain: Array<{ time: Date; amount: bigint }>,
  t: Date
): bigint {
  let s = 0n;
  for (const r of chain) {
    if (r.time > t) break;
    if (r.amount > 0n) s += r.amount;
  }
  return s;
}

/** Надходження (amount > 0) з time >= fromInclusive до t включно; ланцюжок за часом зростає. */
function incomingPositiveFromUtcInclusive(
  chain: Array<{ time: Date; amount: bigint }>,
  fromInclusive: Date,
  t: Date
): bigint {
  let s = 0n;
  for (const r of chain) {
    if (r.time < fromInclusive) continue;
    if (r.time > t) break;
    if (r.amount > 0n) s += r.amount;
  }
  return s;
}

/** Кінець інтервалу виписки для року UTC: до кінця вікна операцій або до 31.12 UTC того ж року. */
export function chainEndInclusiveForUtcYear(utcYear: number, operationsUpperBound: Date): Date {
  const ty = operationsUpperBound.getUTCFullYear();
  if (utcYear < ty) {
    return new Date(Date.UTC(utcYear, 11, 31, 23, 59, 59, 999));
  }
  if (utcYear > ty) {
    return new Date(Date.UTC(utcYear, 11, 31, 23, 59, 59, 999));
  }
  return operationsUpperBound;
}

/**
 * YTD для моменту `through` по вже завантаженому ланцюжку виписки (time asc).
 * Та сама логіка, що й у футері / computeYtdIncomingKopThrough.
 */
export function computeYtdKopFromChainAndManual(
  chainAsc: Array<{ time: Date; amount: bigint }>,
  through: Date,
  manualKop: bigint | null,
  manualDate: Date | null
): bigint {
  const ytdDb = incomingCumThroughTime(chainAsc, through);
  if (manualKop != null && manualDate != null) {
    const bankFrom = startOfNextUtcCalendarDayAfterManualDate(manualDate);
    if (through < bankFrom) {
      return ytdDb;
    }
    return manualKop + incomingPositiveFromUtcInclusive(chainAsc, bankFrom, through);
  }
  return ytdDb;
}

export type AccountFopTurnoverConfig = {
  anchorStart: Date | null;
  monthlyTurnoverManual: bigint | null;
  /** YTD надходження з 1 січня (коп) станом на кінець дня UTC; далі додається виписка після цього дня */
  ytdIncomingManualKop: bigint | null;
  ytdIncomingManualThroughDate: Date | null;
  annualLimitKop: bigint | null;
};

async function loadStatementChain(accountId: string, from: Date, to: Date) {
  return prisma.bankStatementItem.findMany({
    where: {
      accountId,
      time: { gte: from, lte: to },
      account: { includeInOperationsTable: true },
    },
    orderBy: [{ time: "asc" }, { id: "asc" }],
    select: { id: true, time: true, amount: true },
  });
}

export async function computeFopTurnoverForPage(
  pageItems: Array<{ id: string; accountId: string; time: Date }>,
  configs: Map<string, AccountFopTurnoverConfig>,
  options?: { operationsUpperBound?: Date }
): Promise<{
  monthTurnoverByItemId: Map<string, string>;
  ytdTurnoverByItemId: Map<string, string>;
  annualLimitKopByAccountId: Map<string, string>;
  annualRemainingByItemId: Map<string, string | null>;
}> {
  const monthTurnoverByItemId = new Map<string, string>();
  const ytdTurnoverByItemId = new Map<string, string>();
  const annualLimitKopByAccountId = new Map<string, string>();
  const annualRemainingByItemId = new Map<string, string | null>();

  const byAccount = new Map<string, typeof pageItems>();
  for (const it of pageItems) {
    const arr = byAccount.get(it.accountId) ?? [];
    arr.push(it);
    byAccount.set(it.accountId, arr);
  }

  for (const [accountId, accItems] of byAccount) {
    const cfg = configs.get(accountId);
    if (!cfg) continue;

    try {
      if (cfg.annualLimitKop != null && cfg.annualLimitKop > 0n) {
        annualLimitKopByAccountId.set(accountId, cfg.annualLimitKop.toString());
      }

      /** YTD — календарний рік UTC операції; не змішувати роки на одній сторінці (фільтр from/to). */
      const byUtcYear = new Map<number, typeof accItems>();
      for (const it of accItems) {
        const y = it.time.getUTCFullYear();
        const arr = byUtcYear.get(y) ?? [];
        arr.push(it);
        byUtcYear.set(y, arr);
      }

      const chainYtdByYear = new Map<number, Awaited<ReturnType<typeof loadStatementChain>>>();
      for (const [utcYear, yearItems] of byUtcYear) {
        const maxInYear = yearItems.reduce((m, x) => (x.time > m ? x.time : m), yearItems[0].time);
        const yearStartDate = new Date(Date.UTC(utcYear, 0, 1, 0, 0, 0, 0));
        const upper = options?.operationsUpperBound;
        const chainTo =
          upper != null
            ? (() => {
                const cap = chainEndInclusiveForUtcYear(utcYear, upper);
                return maxInYear > cap ? maxInYear : cap;
              })()
            : maxInYear;
        chainYtdByYear.set(utcYear, await loadStatementChain(accountId, yearStartDate, chainTo));
      }

      const anchorStart = cfg.anchorStart;
      const anchorEnd = anchorStart ? endOfUtcCalendarDay(anchorStart) : null;
      const MT = cfg.monthlyTurnoverManual;

      const byMonthKey = new Map<string, typeof accItems>();
      for (const it of accItems) {
        const k = `${it.time.getUTCFullYear()}-${String(it.time.getUTCMonth() + 1).padStart(2, "0")}`;
        const arr = byMonthKey.get(k) ?? [];
        arr.push(it);
        byMonthKey.set(k, arr);
      }

      for (const [, monthItems] of byMonthKey) {
        const ms = utcMonthStart(monthItems[0].time);
        const maxInMonth = monthItems.reduce((m, x) => (x.time > m ? x.time : m), monthItems[0].time);
        const chainMonth = await loadStatementChain(accountId, ms, maxInMonth);

        for (const it of monthItems) {
          const T = it.time;
          const dbCumT = incomingCumThroughTime(chainMonth, T);
          let monthT: bigint;

          if (anchorStart && MT != null && anchorEnd && sameUtcMonth(T, anchorStart)) {
            if (T <= anchorEnd) {
              monthT = dbCumT;
            } else {
              const dbThroughAnchor = incomingCumThroughTime(chainMonth, anchorEnd);
              monthT = MT + dbCumT - dbThroughAnchor;
            }
          } else {
            monthT = dbCumT;
          }

          monthTurnoverByItemId.set(it.id, monthT.toString());

          const utcYear = T.getUTCFullYear();
          const chainYtd = chainYtdByYear.get(utcYear) ?? [];

          const ytd = computeYtdKopFromChainAndManual(
            chainYtd,
            T,
            cfg.ytdIncomingManualKop,
            cfg.ytdIncomingManualThroughDate
          );
          ytdTurnoverByItemId.set(it.id, ytd.toString());

          if (cfg.annualLimitKop != null && cfg.annualLimitKop > 0n) {
            const rem = cfg.annualLimitKop - ytd;
            annualRemainingByItemId.set(it.id, rem.toString());
          } else {
            annualRemainingByItemId.set(it.id, null);
          }
        }
      }
    } catch (err) {
      console.warn(
        "[fop-turnover] Пропуск обороту для рахунку",
        accountId,
        ":",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    monthTurnoverByItemId,
    ytdTurnoverByItemId,
    annualLimitKopByAccountId,
    annualRemainingByItemId,
  };
}

export type YtdManualPreload = {
  ytdIncomingManualKop: bigint | null;
  ytdIncomingManualThroughDate: Date | null;
};

/**
 * Реальні надходження з Monobank (amount > 0) з 1 січня UTC року `through` до моменту `through` включно.
 * З ручним YTD: до початку наступного UTC-дня після дати знімка — лише виписка; далі: знімок + вхідні з банку з 00:00 того наступного дня.
 * ЗЛ = ліміт − це значення.
 *
 * `manualPreload` — якщо передано (наприклад з findMany футера), без додаткового findUnique.
 */
export async function computeYtdIncomingKopThrough(
  accountId: string,
  through: Date,
  manualPreload?: YtdManualPreload | null
): Promise<bigint> {
  let mk: bigint | null;
  let md: Date | null;
  if (manualPreload) {
    mk = manualPreload.ytdIncomingManualKop ?? null;
    md = manualPreload.ytdIncomingManualThroughDate ?? null;
  } else {
    const acc = await prisma.bankAccount.findUnique({
      where: { id: accountId },
      select: {
        ytdIncomingManualKop: true,
        ytdIncomingManualThroughDate: true,
      },
    });
    mk = acc?.ytdIncomingManualKop ?? null;
    md = acc?.ytdIncomingManualThroughDate ?? null;
  }

  const yearStart = utcYearStart(through);
  const chain = await loadStatementChain(accountId, yearStart, through);
  return computeYtdKopFromChainAndManual(chain, through, mk, md);
}
