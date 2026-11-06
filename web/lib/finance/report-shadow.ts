// Тіньовий фінзвіт: виручка з чеків Kresco поруч із числами Altegio. Звіт не змінює.

import { fetchFinanceSummary } from "@/lib/altegio";
import { prisma } from "@/lib/prisma";

export function monthRange(month: string): { from: string; to: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  if (Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function loadFinanceReportShadow(from: string, to: string) {
  const [summary, checkouts, attended] = await Promise.all([
    fetchFinanceSummary({ date_from: from, date_to: to }),
    prisma.salonCheckout.findMany({
      where: { kyivDay: { gte: from, lte: to }, status: { not: "void" } },
      select: { kyivDay: true, totalServices: true, totalGoods: true, paidAmount: true, source: true },
    }),
    prisma.salonAppointment.findMany({
      where: { kyivDay: { gte: from, lte: to }, attendance: 1, status: { not: "deleted" } },
      select: { kyivDay: true, checkout: { select: { id: true } } },
    }),
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
    coverage: {
      attended: attended.length,
      withoutCheckout: withoutCheckout.length,
      daysWithGaps: [...new Set(withoutCheckout.map((a) => a.kyivDay))].sort(),
    },
  };
}
