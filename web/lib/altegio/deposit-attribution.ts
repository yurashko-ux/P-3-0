// Завдатки фінзвіту: «Поповнення рахунку», отримані у звітному місяці,
// мінус ті з них, що в цьому ж місяці вже списані в запис.
// В інкасацію йде лише залишок.

import { ALTEGIO_ENV } from "./env";
import { fetchIncomingPaymentsWithDocumentNumbers } from "./incoming-payments";
import { isDepositTopUpPaymentPurpose } from "./payment-purpose-labels";
import { kyivDayFromISO } from "./records-grouping";
import { getClientRecords, type ClientRecord } from "./records";

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

function kyivDay(date: Date): string {
  return kyivDayFromISO(date.toISOString());
}

/** Запис у звітному місяці і не пізніше сьогодні: завдаток уже списаний у візит. */
function isWrittenOffInReportMonth(appointment: Date, from: string, to: string, todayKyiv: string): boolean {
  const day = kyivDay(appointment);
  if (!day) return false;
  const usedUntil = todayKyiv < to ? todayKyiv : to;
  return day >= from && day <= usedUntil;
}

/**
 * Залишок завдатків звітного місяця: отримані в місяці мінус списані в запис у тому ж місяці.
 * Цей залишок один раз віднімається з інкасації.
 */
export async function getDepositsAttributedToMonth(params: {
  year: number;
  month: number;
}): Promise<{ total: number; items: DepositAttributedItem[] }> {
  const { year, month } = params;
  const { from, to } = reportMonthRange(year, month);
  const todayKyiv = kyivDayFromISO(new Date().toISOString());
  const companyId = resolveCompanyId();

  const payments = await fetchIncomingPaymentsWithDocumentNumbers({
    dateFrom: from,
    dateTo: to,
    companyId: String(companyId),
    includeCashboxAccounts: true,
  });

  const received: DepositAttributedItem[] = [];
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

    received.push({
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

  const recordsCache = new Map<number, ClientRecord[]>();
  const clientIds = [...new Set(received.map((item) => item.clientId).filter((id) => id > 0))];
  const batchSize = 5;
  const delayMs = 200;
  for (let index = 0; index < clientIds.length; index += batchSize) {
    const batch = clientIds.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (clientId) => {
        try {
          recordsCache.set(clientId, await getClientRecords(companyId, clientId));
        } catch (error) {
          console.warn(
            `[deposit-attribution] Не вдалося отримати записи clientId=${clientId}:`,
            error instanceof Error ? error.message : String(error),
          );
          recordsCache.set(clientId, []);
        }
      }),
    );
    if (index + batchSize < clientIds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const items: DepositAttributedItem[] = [];
  let writtenOffCount = 0;
  let writtenOffTotal = 0;

  for (const item of received) {
    const paymentDate = parseDate(item.paymentDate);
    const records = item.clientId > 0 ? recordsCache.get(item.clientId) ?? [] : [];
    const appointment = paymentDate ? findNearestRecordAfterPayment(records, paymentDate) : null;
    if (appointment && isWrittenOffInReportMonth(appointment, from, to, todayKyiv)) {
      writtenOffCount += 1;
      writtenOffTotal += item.amount;
      continue;
    }

    items.push({
      ...item,
      appointmentDate: appointment ? appointment.toISOString() : "",
    });
  }

  const receivedTotal = received.reduce((sum, item) => sum + item.amount, 0);
  const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

  console.log(`[deposit-attribution] Завдатки за ${year}-${String(month).padStart(2, "0")}:`, {
    paymentWindow: { from, to },
    todayKyiv,
    receivedCount: received.length,
    receivedTotal: Math.round(receivedTotal * 100) / 100,
    writtenOffCount,
    writtenOffTotal: Math.round(writtenOffTotal * 100) / 100,
    remainingCount: items.length,
    total,
    skippedNotDeposit,
    skippedOtherMonth,
  });

  return { total, items };
}
