// Завдатки фінзвіту: «Поповнення рахунку», отримані у звітному місяці.
// Віднімаються з інкасації один раз — у місяці оплати, не в місяці візиту.

import { ALTEGIO_ENV } from "./env";
import { fetchIncomingPaymentsWithDocumentNumbers } from "./incoming-payments";
import { isDepositTopUpPaymentPurpose } from "./payment-purpose-labels";
import type { ClientRecord } from "./records";

export type DepositAttributedItem = {
  transactionId: number;
  amount: number;
  paymentDate: string;
  clientId: number;
  payerName: string;
  appointmentDate: string;
  attributedYear: number;
  attributedMonth: number;
};

function resolveCompanyId(): number {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для атрибуції завдатків");
  }
  return Number(companyId);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Календарний місяць звіту, YYYY-MM-DD включно. */
function reportMonthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** Місяць оплати. Altegio віддає салонну дату без пояса — беремо календарний префікс. */
function paymentYearMonth(date: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

/** Чи запис активний і після дати платежу (не видалений, не no-show). */
export function isActiveFutureRecord(record: ClientRecord, afterDate: Date): boolean {
  if (record.deleted) return false;
  if (record.attendance === -1) return false;
  const recordDate = parseDate(record.date);
  if (!recordDate) return false;
  return recordDate.getTime() > afterDate.getTime();
}

/** Найближчий майбутній активний запис після дати платежу. */
export function findNearestRecordAfterPayment(
  records: ClientRecord[],
  paymentDate: Date,
): Date | null {
  let nearest: Date | null = null;
  for (const record of records) {
    if (!isActiveFutureRecord(record, paymentDate)) continue;
    const recordDate = parseDate(record.date);
    if (!recordDate) continue;
    if (!nearest || recordDate.getTime() < nearest.getTime()) {
      nearest = recordDate;
    }
  }
  return nearest;
}

/**
 * Сума завдатків, отриманих у звітному місяці (дата оплати).
 * Один раз віднімається з інкасації цього місяця.
 */
export async function getDepositsAttributedToMonth(params: {
  year: number;
  month: number;
}): Promise<{ total: number; items: DepositAttributedItem[] }> {
  const { year, month } = params;
  const { from, to } = reportMonthRange(year, month);
  const companyId = resolveCompanyId();

  const payments = await fetchIncomingPaymentsWithDocumentNumbers({
    dateFrom: from,
    dateTo: to,
    companyId: String(companyId),
    includeCashboxAccounts: true,
  });

  const items: DepositAttributedItem[] = [];
  let skippedNotDeposit = 0;
  let skippedOtherMonth = 0;

  for (const payment of payments) {
    if (!isDepositTopUpPaymentPurpose(payment.paymentPurpose)) {
      skippedNotDeposit++;
      continue;
    }

    const paid = paymentYearMonth(payment.date);
    if (!paid || paid.year !== year || paid.month !== month) {
      skippedOtherMonth++;
      continue;
    }

    items.push({
      transactionId: payment.transactionId,
      amount: payment.amount,
      paymentDate: payment.date,
      clientId: payment.clientId ?? 0,
      payerName: payment.payerName,
      appointmentDate: "",
      attributedYear: year,
      attributedMonth: month,
    });
  }

  const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

  console.log(`[deposit-attribution] Завдатки, отримані за ${year}-${String(month).padStart(2, "0")}:`, {
    paymentWindow: { from, to },
    paymentsFetched: payments.length,
    depositCount: items.length,
    total,
    skippedNotDeposit,
    skippedOtherMonth,
  });

  return { total, items };
}
