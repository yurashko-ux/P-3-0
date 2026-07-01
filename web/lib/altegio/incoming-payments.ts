import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";
import { isDepositTopUpPaymentPurpose } from "./payment-purpose-labels";

type RawMasterShare = {
  staffId: number | null;
  staffName: string;
  weight: number;
};

export type IncomingPaymentMasterShare = {
  staffId: number | null;
  staffName: string;
  sumUAH: number;
};

export type IncomingPaymentWithDocument = {
  transactionId: number;
  documentId: number | null;
  recordId: number | null;
  documentNumber: string;
  amount: number;
  date: string;
  paymentPurpose: string;
  clientId: number | null;
  payerName: string;
  accountTitle: string;
  accountId: string | null;
  staffId: number | null;
  staffName: string;
  masterBreakdown: IncomingPaymentMasterShare[];
};

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required to fetch incoming payments (optionally can fall back to ALTEGIO_PARTNER_ID / ALTEGIO_APPLICATION_ID)",
    );
  }
  return companyId;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toPositiveMoney(value: unknown): number {
  const amount = Math.abs(toNumber(value));
  return amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function toId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeName(value: unknown): string {
  return String(value || "").trim();
}

function unwrapPayload<T = any>(raw: any): T {
  return (raw?.data ?? raw) as T;
}

function extractArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.transactions)) return raw.transactions;
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.records)) return raw.records;

  return [];
}

function getDocumentNumber(raw: any): string {
  const payload = unwrapPayload<any>(raw);
  const candidates = [
    payload?.number,
    payload?.document_number,
    payload?.documentNumber,
    payload?.state?.number,
    payload?.state?.document_number,
    payload?.document?.number,
  ];

  for (const candidate of candidates) {
    const value = normalizeName(candidate);
    if (value) return value;
  }
  return "";
}

import { resolveAltegioPaymentPurposeFromRaw } from "./payment-purpose-import";

function getPaymentPurpose(transactionRaw: any, documentRaw: any): string {
  const transaction = unwrapPayload<any>(transactionRaw);
  const document = unwrapPayload<any>(documentRaw);

  const fromTransaction = resolveAltegioPaymentPurposeFromRaw(transaction);
  if (fromTransaction) return fromTransaction;
  const fromDocument = resolveAltegioPaymentPurposeFromRaw(document);
  if (fromDocument) return fromDocument;

  const candidates = [
    transaction?.payment_purpose,
    transaction?.paymentPurpose,
    transaction?.purpose,
    transaction?.title,
    transaction?.comment,
    transaction?.expense?.title,
    transaction?.expense?.name,
    document?.payment_purpose,
    document?.paymentPurpose,
    document?.purpose,
    document?.title,
    document?.comment,
    document?.state?.payment_purpose,
    document?.state?.paymentPurpose,
    document?.state?.purpose,
    document?.state?.title,
    document?.state?.comment,
    document?.document?.payment_purpose,
    document?.document?.paymentPurpose,
    document?.document?.purpose,
    document?.document?.title,
    document?.document?.comment,
  ];

  for (const candidate of candidates) {
    const value = normalizeName(candidate);
    if (value) return value;
  }

  return "";
}

export function isEncashmentPaymentPurpose(value: string): boolean {
  const normalized = normalizeName(value).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("інкасац") || normalized.includes("инкасац");
}

export { isDepositTopUpPaymentPurpose } from "./payment-purpose-labels";

function getRecordId(transactionRaw: any): number | null {
  const transaction = unwrapPayload<any>(transactionRaw);
  return toId(
    transaction?.record_id
      ?? transaction?.recordId
      ?? transaction?.record?.id
      ?? transaction?.appointment_id
      ?? transaction?.appointment?.id,
  );
}

function getClientName(transactionRaw: any, documentRaw: any, recordRaw?: any): string {
  const transaction = unwrapPayload<any>(transactionRaw);
  const document = unwrapPayload<any>(documentRaw);
  const record = unwrapPayload<any>(recordRaw);
  const candidates = [
    transaction?.client?.name,
    transaction?.client?.title,
    transaction?.client?.display_name,
    transaction?.client?.full_name,
    transaction?.client?.surname,
    transaction?.client_name,
    transaction?.customer?.name,
    transaction?.customer_name,
    transaction?.visit?.client?.name,
    transaction?.visit?.client?.title,
    transaction?.record?.client?.name,
    transaction?.record?.client?.title,
    transaction?.appointment?.client?.name,
    document?.client?.name,
    document?.client?.title,
    document?.state?.client?.name,
    document?.state?.client?.title,
    document?.customer?.name,
    record?.client?.name,
    record?.client?.title,
    record?.client?.display_name,
    record?.client_name,
    record?.data?.client?.name,
  ];

  for (const candidate of candidates) {
    const value = normalizeName(candidate);
    if (value) return value;
  }
  return "";
}

function getAccountInfo(transactionRaw: any): { accountTitle: string; accountId: string | null } {
  const transaction = unwrapPayload<any>(transactionRaw);
  const account = unwrapPayload<any>(transaction?.account) ?? unwrapPayload<any>(transaction?.cashbox);
  const accountTitle = normalizeName(
    account?.title || account?.name || transaction?.account_title || transaction?.cashbox_title,
  );
  const accountId = toId(transaction?.account_id ?? transaction?.cashbox_id ?? account?.id);
  return {
    accountTitle: accountTitle || "— без рахунку —",
    accountId: accountId != null ? String(accountId) : null,
  };
}

function getDocumentClientId(raw: any): number | null {
  const payload = unwrapPayload<any>(raw);
  const candidates = [
    payload?.client_id,
    payload?.client?.id,
    payload?.client?.client_id,
    payload?.customer_id,
    payload?.customer?.id,
    payload?.record?.client_id,
    payload?.visit?.client_id,
    payload?.appointment?.client_id,
    payload?.state?.client_id,
    payload?.state?.client?.id,
    payload?.state?.customer_id,
  ];

  for (const candidate of candidates) {
    const id = toId(candidate);
    if (id) return id;
  }
  return null;
}

function getTopLevelStaff(raw: any): { staffId: number | null; staffName: string } | null {
  const payload = unwrapPayload<any>(raw);
  const staffCandidates = [
    {
      staffId: toId(payload?.staff_id),
      staffName: normalizeName(payload?.staff?.title || payload?.staff?.name || payload?.staff_name),
    },
    {
      staffId: toId(payload?.master_id),
      staffName: normalizeName(payload?.master?.title || payload?.master?.name || payload?.master_name),
    },
    {
      staffId: toId(payload?.employee_id),
      staffName: normalizeName(payload?.employee?.title || payload?.employee?.name || payload?.employee_name),
    },
    {
      staffId: toId(payload?.state?.staff_id),
      staffName: normalizeName(payload?.state?.staff?.title || payload?.state?.staff?.name || payload?.state?.staff_name),
    },
    {
      staffId: toId(payload?.state?.master_id),
      staffName: normalizeName(payload?.state?.master?.title || payload?.state?.master?.name || payload?.state?.master_name),
    },
  ];

  for (const candidate of staffCandidates) {
    if (candidate.staffId || candidate.staffName) {
      return candidate;
    }
  }
  return null;
}

function getDocumentItems(raw: any): any[] {
  const payload = unwrapPayload<any>(raw);
  const candidates = [
    payload?.state?.items,
    payload?.items,
    payload?.services,
    payload?.records,
    payload?.state?.services,
    payload?.state?.records,
    payload?.document?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function getItemStaff(item: any): { staffId: number | null; staffName: string } | null {
  const candidates = [
    {
      staffId: toId(item?.staff_id),
      staffName: normalizeName(item?.staff?.title || item?.staff?.name || item?.staff_name),
    },
    {
      staffId: toId(item?.master_id),
      staffName: normalizeName(item?.master?.title || item?.master?.name || item?.master_name),
    },
    {
      staffId: toId(item?.employee_id),
      staffName: normalizeName(item?.employee?.title || item?.employee?.name || item?.employee_name),
    },
  ];

  for (const candidate of candidates) {
    if (candidate.staffId || candidate.staffName) return candidate;
  }
  return null;
}

function getItemWeight(item: any): number {
  const directCandidates = [
    item?.total,
    item?.sum,
    item?.amount_total,
    item?.cost_total,
    item?.price_total,
    item?.sale_sum,
    item?.full_cost,
    item?.full_price,
  ];

  for (const candidate of directCandidates) {
    const amount = toPositiveMoney(candidate);
    if (amount > 0) return amount;
  }

  const unitPrice = toPositiveMoney(
    item?.cost ??
      item?.price ??
      item?.sum_per_unit ??
      item?.cost_per_unit ??
      item?.price_per_unit ??
      item?.service_cost,
  );
  const quantity = toNumber(item?.amount ?? item?.quantity ?? item?.count ?? item?.qty ?? 1);
  if (unitPrice > 0 && quantity > 0) {
    return Math.round(unitPrice * quantity * 100) / 100;
  }

  return 0;
}

function distributeAmount(amount: number, shares: RawMasterShare[]): IncomingPaymentMasterShare[] {
  if (amount <= 0 || shares.length === 0) return [];

  const normalized = shares.filter((share) => share.weight > 0 && (share.staffId != null || share.staffName));
  if (normalized.length === 0) return [];

  const totalWeight = normalized.reduce((sum, share) => sum + share.weight, 0);
  if (totalWeight <= 0) return [];

  let allocated = 0;
  return normalized.map((share, index) => {
    const isLast = index === normalized.length - 1;
    const sumUAH = isLast
      ? Math.round((amount - allocated) * 100) / 100
      : Math.round(((amount * share.weight) / totalWeight) * 100) / 100;
    allocated = Math.round((allocated + sumUAH) * 100) / 100;
    return {
      staffId: share.staffId,
      staffName: share.staffName,
      sumUAH,
    };
  });
}

function getDocumentMasterBreakdown(raw: any): RawMasterShare[] {
  const items = getDocumentItems(raw);
  if (!items.length) return [];

  const grouped = new Map<string, RawMasterShare>();
  for (const item of items) {
    const staff = getItemStaff(item);
    if (!staff) continue;

    const weight = getItemWeight(item);
    if (weight <= 0) continue;

    const key = staff.staffId != null ? `id:${staff.staffId}` : `name:${staff.staffName.toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.weight += weight;
      continue;
    }
    grouped.set(key, { ...staff, weight });
  }

  return Array.from(grouped.values()).filter((share) => share.weight > 0);
}

function toAltegioApiYmdDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function isTransferPaymentPurpose(value: string): boolean {
  const normalized = normalizeName(value).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("переміщ") || normalized.includes("перевод") || normalized.includes("transfer");
}

function isIncomeTransaction(transaction: any): boolean {
  const amount = toPositiveMoney(transaction?.amount ?? transaction?.sum);
  if (amount <= 0) return false;

  const purpose = getPaymentPurpose(transaction, null);
  if (isEncashmentPaymentPurpose(purpose) || isTransferPaymentPurpose(purpose)) return false;

  if (transaction?.deleted === true || transaction?.deleted === 1) return false;
  return true;
}

type RecordDetails = {
  clientId: number | null;
  clientName: string;
  staffId: number | null;
  staffName: string;
  masterBreakdown: RawMasterShare[];
};

async function fetchRecordDetails(companyId: string, recordId: number): Promise<RecordDetails | null> {
  const attempts = [
    `records/${recordId}`,
    `records/${companyId}/${recordId}`,
    `company/${companyId}/records/${recordId}`,
  ];

  for (const path of attempts) {
    try {
      const raw = await altegioFetch<any>(path);
      const payload = unwrapPayload<any>(raw);
      const client = payload?.client ?? payload?.data?.client;
      const clientId =
        toId(payload?.client_id ?? client?.id ?? client?.client_id) ??
        getDocumentClientId(payload);
      const clientName = normalizeName(
        client?.name ??
          client?.title ??
          client?.display_name ??
          client?.full_name ??
          payload?.client_name,
      );
      const topLevelStaff = getTopLevelStaff(payload);
      const masterBreakdown = getDocumentMasterBreakdown(payload);

      return {
        clientId,
        clientName,
        staffId: topLevelStaff?.staffId ?? null,
        staffName: topLevelStaff?.staffName ?? "",
        masterBreakdown,
      };
    } catch (error: any) {
      console.warn("[altegio/incoming-payments] Не вдалося отримати запис", {
        recordId,
        path,
        error: error?.message || String(error),
      });
    }
  }

  return null;
}

async function fetchTransactionsForPeriod(
  companyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<any[]> {
  const transactions: any[] = [];
  const countPerPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({
      start_date: toAltegioApiYmdDate(dateFrom),
      end_date: toAltegioApiYmdDate(dateTo),
      balance_is: "1",
      deleted: "0",
      count: String(countPerPage),
      page: String(page),
    });

    const path = `/transactions/${companyId}?${query.toString()}`;
    const raw = await altegioFetch<any>(path);
    const pageItems = extractArray(raw);
    transactions.push(...pageItems);
    if (pageItems.length < countPerPage) break;
  }

  console.log("[altegio/incoming-payments] GET /transactions", {
    dateFrom,
    dateTo,
    dateFormat: "YYYYMMDD",
    rows: transactions.length,
  });

  return transactions;
}

async function fetchDocumentDetails(companyId: string, documentId: number): Promise<any | null> {
  const attempts = [
    `/storage_operations/documents/${companyId}/${documentId}`,
    `/company/${companyId}/sale/${documentId}`,
  ];

  for (const path of attempts) {
    try {
      const raw = await altegioFetch<any>(path);
      const documentNumber = getDocumentNumber(raw);
      if (!documentNumber) {
        console.log("[altegio/incoming-payments] ⚠️ Документ без номера, пропускаємо", { documentId, path });
        return null;
      }
      return raw;
    } catch (error: any) {
      console.warn("[altegio/incoming-payments] Не вдалося отримати документ", {
        documentId,
        path,
        error: error?.message || String(error),
      });
    }
  }

  return null;
}

export async function fetchIncomingPaymentsWithDocumentNumbers(params: {
  dateFrom: string;
  dateTo: string;
  companyId?: string;
  /** Для вхідних Altegio потрібні всі рахунки, включно з Касою. */
  includeCashboxAccounts?: boolean;
}): Promise<IncomingPaymentWithDocument[]> {
  const companyId = params.companyId || resolveCompanyId();
  const transactions = await fetchTransactionsForPeriod(companyId, params.dateFrom, params.dateTo);

  const documentIds = Array.from(
    new Set(
      transactions
        .map((transaction) => toId(transaction?.document_id ?? transaction?.documentId))
        .filter((value): value is number => value != null),
    ),
  );

  const recordIds = Array.from(
    new Set(
      transactions
        .map((transaction) => getRecordId(transaction))
        .filter((value): value is number => value != null),
    ),
  );

  const documentsById = new Map<number, any | null>();
  const batchSize = 10;
  for (let i = 0; i < documentIds.length; i += batchSize) {
    const batch = documentIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (documentId) => ({
        documentId,
        document: await fetchDocumentDetails(companyId, documentId),
      })),
    );

    for (const result of results) {
      documentsById.set(result.documentId, result.document);
    }
  }

  const recordsById = new Map<number, RecordDetails | null>();
  for (let i = 0; i < recordIds.length; i += batchSize) {
    const batch = recordIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (recordId) => ({
        recordId,
        record: await fetchRecordDetails(companyId, recordId),
      })),
    );

    for (const result of results) {
      recordsById.set(result.recordId, result.record);
    }
  }

  const verifiedPayments: IncomingPaymentWithDocument[] = [];
  for (const transaction of transactions) {
    if (!isIncomeTransaction(transaction)) continue;

    const documentId = toId(transaction?.document_id ?? transaction?.documentId);
    const recordId = getRecordId(transaction);
    const clientIdFromTx =
      toId(transaction?.client_id) ??
      toId(transaction?.client?.id);
    if (!documentId && !recordId && !clientIdFromTx) continue;

    const amount = toPositiveMoney(transaction?.amount ?? transaction?.sum);
    if (amount <= 0) continue;

    const document = documentId ? documentsById.get(documentId) ?? null : null;
    const record = recordId ? recordsById.get(recordId) ?? null : null;
    const documentNumber = document ? getDocumentNumber(document) : "";
    if (documentId && !documentNumber) {
      console.log("[altegio/incoming-payments] ⚠️ Документ без номера, використовуємо transaction-only", {
        documentId,
        transactionId: transaction?.id,
      });
    }

    const paymentPurpose = getPaymentPurpose(transaction, document);
    if (isEncashmentPaymentPurpose(paymentPurpose) || isTransferPaymentPurpose(paymentPurpose)) continue;

    const topLevelStaff = document ? getTopLevelStaff(document) : record;
    const staffId =
      toId(transaction?.staff_id) ??
      toId(transaction?.master_id) ??
      topLevelStaff?.staffId ??
      null;
    const staffName = normalizeName(
      transaction?.staff?.title ||
        transaction?.staff?.name ||
        transaction?.staff_name ||
        transaction?.master?.title ||
        transaction?.master?.name ||
        transaction?.master_name ||
        topLevelStaff?.staffName ||
        "",
    );
    const clientId =
      clientIdFromTx ??
      (document ? getDocumentClientId(document) : null) ??
      record?.clientId ??
      null;
    const payerName = getClientName(transaction, document, record) || "— без платника —";
    const { accountTitle, accountId } = getAccountInfo(transaction);
    const normalizedAccount = normalizeName(accountTitle).toLowerCase();
    if (
      !params.includeCashboxAccounts
      && (normalizedAccount === "каса" || normalizedAccount.startsWith("каса "))
    ) {
      continue;
    }

    const rawBreakdown = document
      ? getDocumentMasterBreakdown(document)
      : record?.masterBreakdown ?? [];
    const masterBreakdown = distributeAmount(amount, rawBreakdown);

    verifiedPayments.push({
      transactionId: toId(transaction?.id) ?? 0,
      documentId,
      recordId,
      documentNumber: documentNumber || (recordId ? `record-${recordId}` : String(documentId ?? transaction?.id ?? "")),
      amount,
      date: normalizeName(transaction?.date),
      paymentPurpose,
      clientId,
      payerName,
      accountTitle,
      accountId,
      staffId,
      staffName,
      masterBreakdown,
    });
  }

  console.log("[altegio/incoming-payments] ✅ Вхідні оплати з GET /transactions (+ records/documents)", {
    transactionsFetched: transactions.length,
    verifiedPayments: verifiedPayments.length,
    uniqueDocuments: documentIds.length,
    uniqueRecords: recordIds.length,
  });

  return verifiedPayments;
}
