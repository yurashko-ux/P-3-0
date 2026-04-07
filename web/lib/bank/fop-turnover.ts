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

export type AccountFopTurnoverConfig = {
  anchorStart: Date | null;
  monthlyTurnoverManual: bigint | null;
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
  configs: Map<string, AccountFopTurnoverConfig>
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

    if (cfg.annualLimitKop != null && cfg.annualLimitKop > 0n) {
      annualLimitKopByAccountId.set(accountId, cfg.annualLimitKop.toString());
    }

    const maxTime = accItems.reduce((m, x) => (x.time > m ? x.time : m), accItems[0].time);
    const minTime = accItems.reduce((m, x) => (x.time < m ? x.time : m), accItems[0].time);
    const yearStart = utcYearStart(minTime);
    const chainYtd = await loadStatementChain(accountId, yearStart, maxTime);

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

        const ytd = incomingCumThroughTime(chainYtd, T);
        ytdTurnoverByItemId.set(it.id, ytd.toString());

        if (cfg.annualLimitKop != null && cfg.annualLimitKop > 0n) {
          const rem = cfg.annualLimitKop - ytd;
          annualRemainingByItemId.set(it.id, rem.toString());
        } else {
          annualRemainingByItemId.set(it.id, null);
        }
      }
    }
  }

  return {
    monthTurnoverByItemId,
    ytdTurnoverByItemId,
    annualLimitKopByAccountId,
    annualRemainingByItemId,
  };
}
