/** Чисті функції для призначення платежу — безпечні для client components. */

export const DEPOSIT_PAYMENT_LABEL = "ЗАВДАТОК";

function normalizePaymentPurpose(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function isDepositTopUpPaymentPurpose(value: string): boolean {
  const normalized = normalizePaymentPurpose(value);
  if (!normalized) return false;
  // Міжрахунковий переказ ФОП («Переказ коштів») — НЕ завдаток.
  // Завдаток клієнта = лише «Поповнення рахунку» (депозитний рахунок клієнта).
  if (normalized.includes("переказ коштів") || normalized.includes("переміщ")) {
    return false;
  }
  return (
    normalized.includes("поповнення рахунку")
    || normalized.includes("пополнение счета")
    || normalized.includes("client account top up")
    || normalized.includes("account top up")
  );
}

export function getDepositPaymentLabel(purpose: string | null | undefined): string | null {
  return isDepositTopUpPaymentPurpose(purpose || "") ? DEPOSIT_PAYMENT_LABEL : null;
}
