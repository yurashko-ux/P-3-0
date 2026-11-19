// Розрахунки з постачальниками: проведені прийомки збільшують те, що ми винні, оплати — зменшують.
// Плюс — борг (маємо віддати гроші), мінус — аванс (гроші вже пішли, товар ще їде).
// Оплата — розхід «Закупівля товарів» у Касі/на ФОП з постачальником, або ручний запис (інкасація власниці,
// поки вона в Altegio). Ведемо в доларах; облік стартує з SETTLEMENTS_START_DAY, старіші дні не беремо.
// Запитів до БД: 4 (прийомки, розходи, ручні оплати, курси).

import { prisma } from "@/lib/prisma";
import {
  normalizeSupplierName,
  parsePaymentPlan,
  SETTLEMENTS_START_DAY,
  SUPPLIER_PAYMENT_PURPOSE,
} from "./supplier-settlement-shared";

export * from "./supplier-settlement-shared";

export type SupplierDebtEntry = {
  id: string;
  kind: "intake" | "payment" | "manual";
  kyivDay: string;
  title: string;
  /** + винні більше (прийомка), − заплатили */
  amountUsd: number;
  currency: string;
  amount: number;
};

export type SupplierDebtRow = {
  supplierName: string;
  purchasedUsd: number;
  paidUsd: number;
  /** > 0 — борг, < 0 — аванс */
  balanceUsd: number;
  entries: SupplierDebtEntry[];
};

export type SupplierOpenPayment = {
  id: string;
  kyivDay: string;
  accountTitle: string;
  supplierName: string | null;
  currency: string;
  amount: number;
  amountUsd: number;
  comment: string | null;
};

export type SupplierDebtSummary = {
  /** Сума боргів (балансів > 0), $ */
  debtUsd: number;
  /** Сума авансів (балансів < 0), $ */
  advanceUsd: number;
  suppliers: SupplierDebtRow[];
  /** Оплати «Закупівля товарів» без прийомки — їх можна обрати в прийомці як передоплату */
  openPayments: SupplierOpenPayment[];
  /** Оплати без постачальника: у розрахунки не потрапили, треба вказати кому */
  unassignedPayments: SupplierOpenPayment[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Сума прийомки в доларах. UAH — за курсом документа; без курсу — 0. */
function intakeUsd(doc: { currencyCode: string | null; invoiceAmount: number | null; deliveryAmount: number | null; fxRateUsdUah: number | null }) {
  const amount = (Number(doc.invoiceAmount) || 0) + (Number(doc.deliveryAmount) || 0);
  const code = String(doc.currencyCode || "UAH").toUpperCase();
  if (code === "USD") return { amount, usd: amount };
  const rate = Number(doc.fxRateUsdUah) || 0;
  return { amount, usd: rate > 0 ? amount / rate : 0 };
}

export async function loadSupplierDebts(): Promise<SupplierDebtSummary> {
  const [intakes, documents, manual, rates] = await Promise.all([
    prisma.warehouseDocument.findMany({
      where: { type: "intake", status: "posted", kyivDay: { gte: SETTLEMENTS_START_DAY }, supplierName: { not: null } },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        title: true,
        kyivDay: true,
        supplierName: true,
        currencyCode: true,
        invoiceAmount: true,
        deliveryAmount: true,
        fxRateUsdUah: true,
      },
    }),
    prisma.financeDocument.findMany({
      where: {
        type: "expense",
        status: { not: "void" },
        kyivDay: { gte: SETTLEMENTS_START_DAY },
        purposeTitle: { equals: SUPPLIER_PAYMENT_PURPOSE, mode: "insensitive" },
      },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        kyivDay: true,
        accountTitle: true,
        currency: true,
        amountUah: true,
        amountFx: true,
        comment: true,
        supplierName: true,
        warehouseDocumentId: true,
      },
    }),
    prisma.supplierPayment.findMany({
      where: { voidedAt: null },
      orderBy: { kyivDay: "asc" },
      select: { id: true, supplierName: true, kyivDay: true, currency: true, amount: true, amountUsd: true, comment: true },
    }),
    prisma.dailyFxRate.findMany({
      where: { kyivDay: { gte: SETTLEMENTS_START_DAY } },
      orderBy: { kyivDay: "desc" },
      select: { kyivDay: true, usdWorking: true },
    }),
  ]);

  // Курс дня оплати; немає — найближчий раніший, далі найсвіжіший.
  const latestUsd = rates[0]?.usdWorking || 0;
  const usdRateOn = (day: string) => rates.find((r) => r.kyivDay <= day)?.usdWorking || latestUsd;
  const documentUsd = (doc: (typeof documents)[number]) => {
    if (doc.currency === "USD" && doc.amountFx != null) return doc.amountFx;
    const rate = usdRateOn(doc.kyivDay);
    return rate > 0 ? doc.amountUah / rate : 0;
  };
  const documentAmount = (doc: (typeof documents)[number]) => (doc.currency === "UAH" ? doc.amountUah : doc.amountFx ?? doc.amountUah);

  const bySupplier = new Map<string, SupplierDebtRow>();
  const rowFor = (name: string) => {
    const key = normalizeSupplierName(name);
    let row = bySupplier.get(key);
    if (!row) {
      row = { supplierName: key, purchasedUsd: 0, paidUsd: 0, balanceUsd: 0, entries: [] };
      bySupplier.set(key, row);
    }
    return row;
  };

  for (const doc of intakes) {
    const { amount, usd } = intakeUsd(doc);
    const row = rowFor(doc.supplierName || "");
    row.purchasedUsd += usd;
    row.entries.push({
      id: doc.id,
      kind: "intake",
      kyivDay: doc.kyivDay,
      title: `Прийомка «${doc.title || "без назви"}»`,
      amountUsd: round2(usd),
      currency: String(doc.currencyCode || "UAH").toUpperCase(),
      amount: round2(amount),
    });
  }

  const openPayments: SupplierOpenPayment[] = [];
  const unassignedPayments: SupplierOpenPayment[] = [];
  for (const doc of documents) {
    const usd = documentUsd(doc);
    const supplier = normalizeSupplierName(doc.supplierName);
    const view: SupplierOpenPayment = {
      id: doc.id,
      kyivDay: doc.kyivDay,
      accountTitle: doc.accountTitle || "",
      supplierName: supplier || null,
      currency: doc.currency,
      amount: round2(documentAmount(doc)),
      amountUsd: round2(usd),
      comment: doc.comment,
    };
    if (!doc.warehouseDocumentId) openPayments.push(view);
    if (!supplier) {
      unassignedPayments.push(view);
      continue;
    }
    const row = rowFor(supplier);
    row.paidUsd += usd;
    row.entries.push({
      id: doc.id,
      kind: "payment",
      kyivDay: doc.kyivDay,
      title: `Оплата з «${doc.accountTitle || "рахунку"}»${doc.comment ? ` — ${doc.comment}` : ""}`,
      amountUsd: round2(-usd),
      currency: doc.currency,
      amount: round2(documentAmount(doc)),
    });
  }

  for (const payment of manual) {
    const row = rowFor(payment.supplierName);
    row.paidUsd += payment.amountUsd;
    row.entries.push({
      id: payment.id,
      kind: "manual",
      kyivDay: payment.kyivDay,
      title: payment.comment || "Оплата (інкасація)",
      amountUsd: round2(-payment.amountUsd),
      currency: payment.currency,
      amount: round2(payment.amount),
    });
  }

  const suppliers = [...bySupplier.values()]
    .map((row) => ({
      ...row,
      purchasedUsd: round2(row.purchasedUsd),
      paidUsd: round2(row.paidUsd),
      balanceUsd: round2(row.purchasedUsd - row.paidUsd),
      entries: row.entries.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay)),
    }))
    .sort((a, b) => Math.abs(b.balanceUsd) - Math.abs(a.balanceUsd));
  const debtUsd = round2(suppliers.reduce((sum, row) => sum + Math.max(0, row.balanceUsd), 0));
  const advanceUsd = round2(suppliers.reduce((sum, row) => sum + Math.max(0, -row.balanceUsd), 0));
  console.log(
    `[supplier-debt] Борг ${debtUsd} $, аванси ${advanceUsd} $: постачальників ${suppliers.length}, прийомок ${intakes.length}, ` +
      `оплат ${documents.length} (без постачальника ${unassignedPayments.length}), ручних ${manual.length}`,
  );
  return { debtUsd, advanceUsd, suppliers, openPayments, unassignedPayments };
}

/** Що бракує в оплаті прийомки перед проведенням. Документи без плану (старі) не перевіряємо. */
export function missingPaymentFields(doc: { supplierName: string | null; paymentPlan: unknown }): string[] {
  const plan = parsePaymentPlan(doc.paymentPlan);
  if (!plan) return [];
  const missing: string[] = [];
  if (!normalizeSupplierName(doc.supplierName)) missing.push("постачальник");
  if (plan.mode === "now") {
    if (!plan.accountId) missing.push("рахунок оплати");
    if (!(Number(plan.amount) > 0)) missing.push("сума оплати");
  }
  if (plan.mode === "prepaid" && !plan.financeDocumentIds?.length) missing.push("передоплата (оберіть платіж)");
  return missing;
}

/**
 * Після проведення прийомки: «оплачено зараз» — створюємо розхід «Закупівля товарів»;
 * «передоплата» — прив'язуємо обрані розходи. Повторний виклик нічого не дублює.
 * Помилка оплати не скасовує прийомку: пишемо її в план і лог.
 */
export async function settleIntakePayment(documentId: string, postedBy?: string | null): Promise<void> {
  const doc = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, type: true, supplierName: true, occurredAt: true, paymentPlan: true },
  });
  const plan = doc ? parsePaymentPlan(doc.paymentPlan) : null;
  if (!doc || doc.type !== "intake" || !plan || plan.mode === "credit") return;
  const supplierName = normalizeSupplierName(doc.supplierName);

  try {
    if (plan.mode === "now") {
      if (plan.createdFinanceDocumentId) return;
      const purpose = await prisma.altegioPaymentPurpose.findFirst({
        where: { isActive: true, title: { equals: SUPPLIER_PAYMENT_PURPOSE, mode: "insensitive" } },
        select: { id: true },
      });
      if (!purpose) throw new Error(`Немає статті «${SUPPLIER_PAYMENT_PURPOSE}»`);
      // Динамічний імпорт: фіндокументи → журнал → склад → цей модуль — статичний імпорт дав би коло
      const { createFinanceDocument } = await import("@/lib/finance/documents-kresco");
      const finance = await createFinanceDocument({
        type: "expense",
        amount: Number(plan.amount) || 0,
        accountId: Number(plan.accountId) || 0,
        purposeId: purpose.id,
        occurredAt: doc.occurredAt,
        comment: `Оплата прийомки «${doc.title || ""}» — ${supplierName}`,
        createdBy: postedBy || null,
      });
      await prisma.financeDocument.update({
        where: { id: finance.id },
        data: { supplierName, warehouseDocumentId: doc.id },
      });
      await prisma.warehouseDocument.update({
        where: { id: doc.id },
        data: { paymentPlan: { ...plan, createdFinanceDocumentId: finance.id, error: null } },
      });
      console.log(`[supplier-debt] ✅ Прийомка ${doc.id}: розхід ${finance.id} ${plan.amount} з рахунку ${plan.accountId}`);
      return;
    }

    // Передоплата: прив'язуємо лише ще вільні розходи; постачальника доповнюємо, якщо не вказано.
    const ids = plan.financeDocumentIds || [];
    const free = await prisma.financeDocument.findMany({
      where: { id: { in: ids }, warehouseDocumentId: null },
      select: { id: true, supplierName: true },
    });
    for (const row of free) {
      await prisma.financeDocument.update({
        where: { id: row.id },
        data: { warehouseDocumentId: doc.id, supplierName: row.supplierName || supplierName },
      });
    }
    console.log(`[supplier-debt] ✅ Прийомка ${doc.id}: прив'язано передоплат ${free.length} з ${ids.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[supplier-debt] Прийомка ${doc.id}: оплату не записано:`, message);
    await prisma.warehouseDocument
      .update({ where: { id: doc.id }, data: { paymentPlan: { ...plan, error: message } } })
      .catch(() => null);
  }
}
