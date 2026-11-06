// Дані Фінзвіту з Kresco: чеки, собівартість у рядках чека, локальні фінансові операції.
// Форма та сама, що в Altegio, тому розрахунки сторінки не змінюються.

import {
  fetchExpensesSummary,
  type AltegioFinanceTransaction,
  type ExpensesSummary,
  type FinanceSummary,
  type GoodsSalesSummary,
} from "@/lib/altegio";
import { prisma } from "@/lib/prisma";

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function paidCheckouts(from: string, to: string) {
  return {
    kyivDay: { gte: from, lte: to },
    status: { not: "void" },
    appointment: { status: { not: "deleted" } },
  };
}

export async function fetchKrescoFinanceSummary(from: string, to: string): Promise<FinanceSummary> {
  const checkouts = await prisma.salonCheckout.findMany({
    where: paidCheckouts(from, to),
    select: { kyivDay: true, totalServices: true, totalGoods: true },
  });
  const byDay = new Map<string, number>();
  let services = 0;
  let goods = 0;
  for (const c of checkouts) {
    const dayServices = Number(c.totalServices) || 0;
    const dayGoods = Number(c.totalGoods) || 0;
    services += dayServices;
    goods += dayGoods;
    byDay.set(c.kyivDay, (byDay.get(c.kyivDay) || 0) + dayServices + dayGoods);
  }
  const total = money(services + goods);
  return {
    range: { date_from: from, date_to: to },
    currency: "UAH",
    totals: {
      total,
      services: money(services),
      goods: money(goods),
      avgCheck: checkouts.length > 0 ? money(total / checkouts.length) : null,
    },
    incomeDaily: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value: money(value) })),
  };
}

export async function fetchKrescoGoodsSummary(from: string, to: string): Promise<GoodsSalesSummary> {
  const lines = await prisma.salonCheckoutGoodLine.findMany({
    where: { checkout: paidCheckouts(from, to) },
    select: {
      quantity: true,
      salePrice: true,
      costPerUnit: true,
      product: { select: { isHair: true } },
    },
  });
  let revenue = 0;
  let cost = 0;
  let hairCost = 0;
  let sold = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity) || 0;
    const lineCost = (Number(line.costPerUnit) || 0) * quantity;
    revenue += (Number(line.salePrice) || 0) * quantity;
    cost += lineCost;
    if (line.product.isHair) hairCost += lineCost;
    sold += quantity;
  }
  return {
    range: { date_from: from, date_to: to },
    revenue: money(revenue),
    cost: money(cost),
    hairCost: money(hairCost),
    profit: money(revenue - cost),
    costSource: "sale_document",
    itemsCount: lines.length,
    totalItemsSold: sold,
  };
}

export async function fetchKrescoExpensesSummary(from: string, to: string): Promise<ExpensesSummary> {
  const rows = await prisma.altegioFinanceTransaction.findMany({
    where: { kyivDay: { gte: from, lte: to }, deletedInAltegio: false },
    select: { rawData: true },
  });
  return fetchExpensesSummary({
    date_from: from,
    date_to: to,
    localTransactions: rows.map((row) => row.rawData as unknown as AltegioFinanceTransaction),
  });
}
