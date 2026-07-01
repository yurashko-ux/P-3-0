// Атрибуція завдатків (Поповнення рахунку) до місяця майбутнього запису клієнта.

import { ALTEGIO_ENV } from "./env";
import { ALTEGIO_FINANCE_SYNC_START_DATE } from "./finance-transactions-sync";
import { fetchIncomingPaymentsWithDocumentNumbers } from "./incoming-payments";
import { isDepositTopUpPaymentPurpose } from "./payment-purpose-labels";
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

function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function subtractMonths(year: number, month: number, monthsBack: number): { year: number; month: number } {
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - monthsBack);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function paymentSearchWindow(reportYear: number, reportMonth: number): { from: string; to: string } {
  const { year: fromYear, month: fromMonth } = subtractMonths(reportYear, reportMonth, 24);
  const fromCandidate = formatDateISO(new Date(fromYear, fromMonth - 1, 1));
  const from = fromCandidate < ALTEGIO_FINANCE_SYNC_START_DATE
    ? ALTEGIO_FINANCE_SYNC_START_DATE
    : fromCandidate;
  const to = formatDateISO(new Date(reportYear, reportMonth, 0));
  return { from, to };
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
 * Сума завдатків, що відносяться до звітного місяця за датою найближчого запису після платежу.
 */
export async function getDepositsAttributedToMonth(params: {
  year: number;
  month: number;
}): Promise<{ total: number; items: DepositAttributedItem[] }> {
  const { year, month } = params;
  const { from, to } = paymentSearchWindow(year, month);
  const companyId = resolveCompanyId();

  const payments = await fetchIncomingPaymentsWithDocumentNumbers({
    dateFrom: from,
    dateTo: to,
    companyId: String(companyId),
    includeCashboxAccounts: true,
  });

  const depositPayments = payments.filter((payment) =>
    isDepositTopUpPaymentPurpose(payment.paymentPurpose),
  );

  const recordsCache = new Map<number, ClientRecord[]>();
  const uniqueClientIds = [
    ...new Set(
      depositPayments
        .map((payment) => payment.clientId)
        .filter((clientId): clientId is number => clientId != null),
    ),
  ];

  const batchSize = 5;
  const delayMs = 200;
  for (let index = 0; index < uniqueClientIds.length; index += batchSize) {
    const batch = uniqueClientIds.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (clientId) => {
        try {
          const records = await getClientRecords(companyId, clientId);
          recordsCache.set(clientId, records);
        } catch (error) {
          console.warn(
            `[deposit-attribution] Не вдалося отримати записи clientId=${clientId}:`,
            error instanceof Error ? error.message : String(error),
          );
          recordsCache.set(clientId, []);
        }
      }),
    );
    if (index + batchSize < uniqueClientIds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const items: DepositAttributedItem[] = [];
  let skippedNoClient = 0;
  let skippedNoAppointment = 0;
  let skippedWrongMonth = 0;

  for (const payment of depositPayments) {
    if (!payment.clientId) {
      skippedNoClient++;
      continue;
    }

    const paymentDate = parseDate(payment.date);
    if (!paymentDate) continue;

    const records = recordsCache.get(payment.clientId) ?? [];
    const appointmentDate = findNearestRecordAfterPayment(records, paymentDate);
    if (!appointmentDate) {
      skippedNoAppointment++;
      continue;
    }

    const attributedYear = appointmentDate.getFullYear();
    const attributedMonth = appointmentDate.getMonth() + 1;
    if (attributedYear !== year || attributedMonth !== month) {
      skippedWrongMonth++;
      continue;
    }

    items.push({
      transactionId: payment.transactionId,
      amount: payment.amount,
      paymentDate: payment.date,
      clientId: payment.clientId,
      payerName: payment.payerName,
      appointmentDate: appointmentDate.toISOString(),
      attributedYear,
      attributedMonth,
    });
  }

  const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

  console.log(`[deposit-attribution] Завдатки за ${year}-${String(month).padStart(2, "0")}:`, {
    paymentWindow: { from, to },
    depositPaymentsFound: depositPayments.length,
    uniqueClients: uniqueClientIds.length,
    attributedCount: items.length,
    total,
    skippedNoClient,
    skippedNoAppointment,
    skippedWrongMonth,
  });

  return { total, items };
}
