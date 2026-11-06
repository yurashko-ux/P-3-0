// Дані Фінзвіту з Kresco: чеки, собівартість у рядках чека, локальні фінансові операції.
// Форма та сама, що в Altegio, тому розрахунки сторінки не змінюються.

import {
  fetchExpensesSummary,
  type AltegioFinanceTransaction,
  type ExpensesSummary,
  type FinanceSummary,
  type GoodsSalesSummary,
} from "@/lib/altegio";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
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

/** Чек, оплачений завдатком: гроші вже враховані в день поповнення, повторно не рахуємо. */
function isPaidFromDeposit(
  checkout: {
    source: string;
    payments: Array<{ paymentKind: string }>;
    appointment: { altegioRecordId: number | null; altegioVisitId: number | null };
  },
  paidRecordIds: Set<number>,
  paidVisitIds: Set<number>,
): boolean {
  if (checkout.source === "kresco") {
    return checkout.payments.length > 0 && checkout.payments.every((p) => p.paymentKind === "deposit");
  }
  // В імпортованому чеку спосіб оплати невідомий: шукаємо живий платіж запису або його візиту.
  const { altegioRecordId, altegioVisitId } = checkout.appointment;
  if (altegioVisitId != null && paidVisitIds.has(altegioVisitId)) return false;
  return altegioRecordId == null || !paidRecordIds.has(altegioRecordId);
}

/** Виручка визнається в день надходження грошей: завдаток — при поповненні, а не при списанні. */
export async function fetchKrescoFinanceSummary(from: string, to: string): Promise<FinanceSummary> {
  const [checkouts, incomeRows, krescoTopUps] = await Promise.all([
    prisma.salonCheckout.findMany({
      where: paidCheckouts(from, to),
      select: {
        kyivDay: true,
        totalServices: true,
        totalGoods: true,
        source: true,
        payments: { select: { paymentKind: true } },
        appointment: { select: { altegioRecordId: true, altegioVisitId: true } },
      },
    }),
    prisma.altegioFinanceTransaction.findMany({
      // Стаття доходу приходить як expense_id, тому direction доходу буває «out»: орієнтир — знак суми.
      where: {
        kyivDay: { gte: from, lte: to },
        deletedInAltegio: false,
        amountKopiykas: { gt: 0 },
        direction: { not: "transfer" },
      },
      select: { kyivDay: true, amountKopiykas: true, paymentPurpose: true, rawData: true },
    }),
    // Поповнення, що є лише в Kresco; імпортовані вже прийшли з фінансових операцій.
    prisma.clientDepositLedgerEntry.findMany({
      where: {
        kind: "topup",
        source: "kresco",
        altegioPaymentTxId: null,
        kyivDay: { gte: from, lte: to },
        amount: { gt: 0 },
      },
      select: { kyivDay: true, amount: true },
    }),
  ]);

  const paidRecordIds = new Set<number>();
  const topUps = krescoTopUps.map((row) => ({ kyivDay: row.kyivDay, amount: row.amount }));
  for (const row of incomeRows) {
    if (isDepositTopUpPaymentPurpose(row.paymentPurpose || "")) {
      topUps.push({ kyivDay: row.kyivDay, amount: Number(row.amountKopiykas) / 100 });
      continue;
    }
    const recordId = Number((row.rawData as { record_id?: unknown } | null)?.record_id) || 0;
    if (recordId > 0) paidRecordIds.add(recordId);
  }
  const paidVisitIds = new Set(
    checkouts
      .filter((c) => c.appointment.altegioRecordId != null && paidRecordIds.has(c.appointment.altegioRecordId))
      .map((c) => c.appointment.altegioVisitId)
      .filter((id): id is number => id != null),
  );

  const byDay = new Map<string, number>();
  let services = 0;
  let goods = 0;
  let received = 0;
  for (const c of checkouts) {
    if (isPaidFromDeposit(c, paidRecordIds, paidVisitIds)) continue;
    const dayServices = Number(c.totalServices) || 0;
    const dayGoods = Number(c.totalGoods) || 0;
    services += dayServices;
    goods += dayGoods;
    received += 1;
    byDay.set(c.kyivDay, (byDay.get(c.kyivDay) || 0) + dayServices + dayGoods);
  }
  let deposits = 0;
  for (const row of topUps) {
    deposits += row.amount;
    byDay.set(row.kyivDay, (byDay.get(row.kyivDay) || 0) + row.amount);
  }
  const total = money(services + goods + deposits);
  return {
    range: { date_from: from, date_to: to },
    currency: "UAH",
    totals: {
      total,
      services: money(services),
      goods: money(goods),
      avgCheck: received > 0 ? money((services + goods) / received) : null,
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
