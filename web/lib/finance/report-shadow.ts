// Тіньовий фінзвіт: виручка з чеків Kresco поруч із числами Altegio. Звіт не змінює.

import { fetchExpensesSummary, fetchFinanceSummary, fetchGoodsSalesSummary } from "@/lib/altegio";
import { fetchKrescoFinanceSummary } from "@/lib/finance/report-kresco";
import { prisma } from "@/lib/prisma";

/** Статті з API Altegio під назвами, що зберігаються в операціях Kresco. */
const EXPENSE_CATEGORY_ALIASES: Record<string, string> = {
  "Miscellaneous expenses": "Інші витрати",
  "Consumables purchase": "Закупівля матеріалів",
  "Маркетинг": "Маркетинг CMM",
  "Product purchase": "Закупівля товарів",
  "Закуплено товару": "Закупівля товарів",
  "Закуплений товар": "Закупівля товарів",
  "Team salaries": "Зарплата співробітникам",
  "Rent": "Оренда",
  "Taxes and fees": "Податки та збори",
};

/** Direction у старих рядках ненадійний: доходи й перекази не є витратами звіту. */
function isExpensePurpose(purpose: string): boolean {
  if (/^(Надання послуг|Продаж товарів|Продаж абонементів|Продаж сертифікатів|Поповнення рахунку|Доходи)$/.test(purpose)) {
    return false;
  }
  return !/^Переміщення/.test(purpose) && purpose !== "Без статті";
}

/** Графік Altegio віддає дату рядком або timestamp, хоч тип і каже string. */
function incomeDay(date: unknown): string {
  if (typeof date !== "number") return String(date).slice(0, 10);
  const ms = date > 1e11 ? date : date * 1000;
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
}

export function monthRange(month: string): { from: string; to: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  if (Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function loadFinanceReportShadow(from: string, to: string) {
  const [summary, expenses, localExpenses, checkouts, attended, salesWithoutRecord, received] = await Promise.all([
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
        AND "amountKopiykas" > 0
        AND "direction" <> 'transfer'
        AND "paymentPurpose" = 'Продаж товарів'
        AND COALESCE(NULLIF("rawData"->>'record_id', '0'), '') = ''
    `,
    fetchKrescoFinanceSummary(from, to),
  ]);

  const kresco = { services: 0, goods: 0, total: 0, checkouts: checkouts.length };
  const krescoByDay = new Map(received.incomeDaily.map((d) => [String(d.date), Number(d.value) || 0]));
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

  const localByCategory = new Map<string, number>();
  for (const row of localExpenses) {
    const purpose = row.purpose || "Без статті";
    if (!isExpensePurpose(purpose)) continue;
    localByCategory.set(purpose, (localByCategory.get(purpose) || 0) + Number(row.kopiykas ?? 0) / 100);
  }
  const reportedByCategory = new Map<string, number>();
  for (const [category, amount] of Object.entries(expenses.byCategory)) {
    const name = EXPENSE_CATEGORY_ALIASES[category] || category;
    reportedByCategory.set(name, (reportedByCategory.get(name) || 0) + Math.abs(Number(amount) || 0));
  }
  const expenseCategories = new Set([...reportedByCategory.keys(), ...localByCategory.keys()]);
  const expenseRows = [...expenseCategories]
    .map((category) => {
      const reported = reportedByCategory.get(category) || 0;
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
      services: received.totals.services - altegio.services,
      goods: received.totals.goods - altegio.goods,
      total: received.totals.total - altegio.total,
    },
    received: received.totals,
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
    days: [...new Set([...summary.incomeDaily.map((d) => incomeDay(d.date)), ...krescoByDay.keys()])]
      .sort()
      .map((day) => {
        const altegioDay = summary.incomeDaily
          .filter((d) => incomeDay(d.date) === day)
          .reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        const krescoDay = krescoByDay.get(day) || 0;
        return { day, altegio: altegioDay, kresco: krescoDay, diff: Math.round((krescoDay - altegioDay) * 100) / 100 };
      })
      .filter((row) => Math.abs(row.diff) >= 1),
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
