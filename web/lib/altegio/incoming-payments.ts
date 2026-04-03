import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";

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
  documentId: number;
  documentNumber: string;
  amount: number;
  date: string;
  paymentPurpose: string;
  clientId: number | null;
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

function getPaymentPurpose(transactionRaw: any, documentRaw: any): string {
  const transaction = unwrapPayload<any>(transactionRaw);
  const document = unwrapPayload<any>(documentRaw);
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
}): Promise<IncomingPaymentWithDocument[]> {
  const companyId = params.companyId || resolveCompanyId();
  const transactions: any[] = [];
  const countPerPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({
      start_date: params.dateFrom,
      end_date: params.dateTo,
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

  const documentIds = Array.from(
    new Set(
      transactions
        .map((transaction) => toId(transaction?.document_id))
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

  const verifiedPayments: IncomingPaymentWithDocument[] = [];
  for (const transaction of transactions) {
    const documentId = toId(transaction?.document_id);
    if (!documentId) continue;

    const document = documentsById.get(documentId);
    if (!document) continue;

    const amount = toPositiveMoney(transaction?.amount);
    if (amount <= 0) continue;

    const documentNumber = getDocumentNumber(document);
    if (!documentNumber) continue;

    const paymentPurpose = getPaymentPurpose(transaction, document);

    const topLevelStaff = getTopLevelStaff(document);
    const staffId = toId(transaction?.staff_id) ?? topLevelStaff?.staffId ?? null;
    const staffName = normalizeName(
      transaction?.staff?.title ||
        transaction?.staff?.name ||
        transaction?.staff_name ||
        topLevelStaff?.staffName ||
        "",
    );
    const clientId =
      toId(transaction?.client_id) ??
      toId(transaction?.client?.id) ??
      getDocumentClientId(document);

    const rawBreakdown = getDocumentMasterBreakdown(document);
    const masterBreakdown = distributeAmount(amount, rawBreakdown);

    verifiedPayments.push({
      transactionId: toId(transaction?.id) ?? 0,
      documentId,
      documentNumber,
      amount,
      date: normalizeName(transaction?.date),
      paymentPurpose,
      clientId,
      staffId,
      staffName,
      masterBreakdown,
    });
  }

  console.log("[altegio/incoming-payments] ✅ Підтверджені вхідні оплати з номером документа", {
    transactionsFetched: transactions.length,
    verifiedPayments: verifiedPayments.length,
    uniqueDocuments: documentIds.length,
  });

  return verifiedPayments;
}
