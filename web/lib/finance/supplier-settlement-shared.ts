// Розрахунки з постачальниками: константи й чисті функції, спільні для сервера і браузера (без Prisma).

export const SETTLEMENTS_START_DAY = "2026-11-19";
/** Стаття розходу, яка означає оплату постачальнику. */
export const SUPPLIER_PAYMENT_PURPOSE = "Закупівля товарів";

export type PaymentPlanMode = "now" | "prepaid" | "credit";

export type IntakePaymentPlan = {
  mode: PaymentPlanMode;
  /** now: рахунок Altegio (каса / ФОП), з якого платимо */
  accountId?: number | null;
  /** now: сума у валюті рахунку */
  amount?: number | null;
  /** prepaid: розходи «Закупівля товарів», зроблені раніше */
  financeDocumentIds?: string[];
  /** now: розхід, створений проведенням (захист від повтору) */
  createdFinanceDocumentId?: string | null;
  error?: string | null;
};

export function normalizeSupplierName(name: unknown): string {
  return String(name || "").trim().replace(/\s+/g, " ");
}

export function isSupplierPaymentPurpose(title: string | null | undefined): boolean {
  return String(title || "").trim().toLowerCase() === SUPPLIER_PAYMENT_PURPOSE.toLowerCase();
}

export function parsePaymentPlan(raw: unknown): IntakePaymentPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mode = value.mode === "now" || value.mode === "prepaid" || value.mode === "credit" ? value.mode : null;
  if (!mode) return null;
  return {
    mode,
    accountId: Number(value.accountId) || null,
    amount: Number(value.amount) || null,
    financeDocumentIds: Array.isArray(value.financeDocumentIds) ? value.financeDocumentIds.map(String).filter(Boolean) : [],
    createdFinanceDocumentId: typeof value.createdFinanceDocumentId === "string" ? value.createdFinanceDocumentId : null,
    error: typeof value.error === "string" ? value.error : null,
  };
}
