// Тіньовий фінзвіт: виручка з чеків Kresco поруч із числами Altegio. Звіт не змінює.

import { fetchExpensesSummary, fetchFinanceSummary, fetchGoodsSalesSummary } from "@/lib/altegio";
import { prisma } from "@/lib/prisma";

export function monthRange(month: string): { from: string; to: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  if (Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function loadFinanceReportShadow(from: string, to: string) {
  const [summary, expenses, localExpenses, checkouts, attended, salesWithoutRecord] = await Promise.all([
    fetchFinanceSummary({ date_from: from, date_to: to }),
    fetchExpensesSummary({ date_from: from, date_to: to }),
    prisma.$queryRaw<Array<{ purpose: string | null; kopiykas: bigint | null }>>`
      SELECT "paymentPurpose" AS purpose, SUM(ABS("amountKopiykas")) AS kopiykas
      FROM "altegio_finance_transactions"
      WHERE "kyivDay" >= ${from} AND "kyivDay" <= ${to}
        AND "deletedInAltegio" = false
        AND "direction" = 'out'
      GROUP BY 1
    `,
    prisma.salonCheckout.findMany({
      where: {
        kyivDay: { gte: from, lte: to },
        status: { not: "void" },
        appointment: { status: { not: "deleted" } },
      },
      select: { kyivDay: true, totalServices: true, totalGoods: true, paidAmount: true, source: true },
    }),
    prisma.salonAppointment.findMany({
      where: { kyivDay: { gte: from, lte: to }, attendance: 1, status: { not: "deleted" } },
      select: { kyivDay: true, checkout: { select: { id: true } } },
    }),
    // Продаж товару без запису: у журнал не потрапляє, лише у фінансові операції.
    prisma.$queryRaw<Array<{ kopiykas: bigint | null; count: bigint }>>`
      SELECT SUM("amountKopiykas") AS kopiykas, COUNT(*) AS count
      FROM "altegio_finance_transactions"
      WHERE "kyivDay" >= ${from} AND "kyivDay" <= ${to}
        AND "deletedInAltegio" = false
        AND "direction" = 'in'
        AND "paymentPurpose" = 'Продаж товарів'
        AND COALESCE(NULLIF("rawData"->>'record_id', '0'), '') = ''
    `,
  ]);

  const kresco = { services: 0, goods: 0, total: 0, checkouts: checkouts.length };
  for (const c of checkouts) {
    kresco.services += Number(c.totalServices) || 0;
    kresco.goods += Number(c.totalGoods) || 0;
    kresco.total += Number(c.paidAmount) || 0;
  }
  const withoutCheckout = attended.filter((a) => !a.checkout);
  const altegio = {
    services: Number(summary.totals?.services) || 0,
    goods: Number(summary.totals?.goods) || 0,
    total: Number(summary.totals?.total) || 0,
  };
  const [goodsSummary, soldLines] = await Promise.all([
    fetchGoodsSalesSummary({
      date_from: from,
      date_to: to,
      salonGoodsRevenueUah: summary.totals?.goods,
      incomeGoodsStatsExtras: summary.incomeGoodsStatsExtras,
    }),
    prisma.salonCheckoutGoodLine.findMany({
      where: {
        checkout: {
          kyivDay: { gte: from, lte: to },
          status: { not: "void" },
          appointment: { status: { not: "deleted" } },
        },
      },
      select: { title: true, quantity: true, costPerUnit: true, product: { select: { isHair: true } } },
    }),
  ]);
  const cost = { total: 0, hair: 0, goods: 0, withoutCost: [] as string[] };
  for (const line of soldLines) {
    if (line.costPerUnit == null) {
      cost.withoutCost.push(line.title);
      continue;
    }
    const amount = line.costPerUnit * line.quantity;
    cost.total += amount;
    if (line.product.isHair) cost.hair += amount;
    else cost.goods += amount;
  }

  const localByCategory = new Map(
    localExpenses.map((row) => [row.purpose || "Без статті", Number(row.kopiykas ?? 0) / 100]),
  );
  const expenseCategories = new Set([...Object.keys(expenses.byCategory), ...localByCategory.keys()]);
  const expenseRows = [...expenseCategories]
    .map((category) => {
      const reported = Math.abs(Number(expenses.byCategory[category]) || 0);
      const local = localByCategory.get(category) || 0;
      return { category, altegio: reported, local, diff: Math.round((local - reported) * 100) / 100 };
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    from,
    to,
    altegio,
    kresco,
    diff: {
      services: kresco.services - altegio.services,
      goods: kresco.goods - altegio.goods,
      total: kresco.total - altegio.total,
    },
    cost: {
      altegio: { total: goodsSummary.cost, hair: goodsSummary.hairCost, source: goodsSummary.costSource },
      kresco: cost,
      diff: Math.round((cost.total - goodsSummary.cost) * 100) / 100,
    },
    expenses: {
      altegioTotal: expenses.total,
      localTotal: [...localByCategory.values()].reduce((sum, value) => sum + value, 0),
      rows: expenseRows,
    },
    salesWithoutRecord: {
      uah: Number(salesWithoutRecord[0]?.kopiykas ?? 0) / 100,
      count: Number(salesWithoutRecord[0]?.count ?? 0),
    },
    coverage: {
      attended: attended.length,
      withoutCheckout: withoutCheckout.length,
      daysWithGaps: [...new Set(withoutCheckout.map((a) => a.kyivDay))].sort(),
    },
  };
}
