import { prisma } from "@/lib/prisma";
import { altegioFetch } from "@/lib/altegio/client";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import { ALTEGIO_FINANCE_SYNC_START_DATE } from "@/lib/altegio/finance-transactions-sync";

export type IncomingBankRowKind = "universal_bank_aggregate" | "named_incoming" | "unknown";

export type NormalizedAltegioIncomeRow = {
  altegioId: number;
  documentId: number | null;
  accountTitle: string;
  accountId: string | null;
  payerName: string;
  amountKop: bigint;
  paymentPurpose: string | null;
  paymentMethodUnknown: boolean;
  source: "db" | "live";
};

export type AltegioClientAggregate = {
  payerName: string;
  totalKop: string;
  transactionCount: number;
  items: Array<{
    altegioId: number;
    documentId: number | null;
    amountKop: string;
    paymentPurpose: string | null;
    paymentMethodUnknown: boolean;
  }>;
};

export type AltegioAccountAggregate = {
  accountTitle: string;
  accountId: string | null;
  totalKop: string;
  byClient: AltegioClientAggregate[];
};

export type BankIncomingItem = {
  id: string;
  time: string;
  amountKop: string;
  description: string;
  comment: string | null;
  counterName: string | null;
  kind: IncomingBankRowKind;
  commissionKop: string | null;
  commissionRaw: string | null;
};

export type BankAccountAggregate = {
  accountLabel: string;
  accountId: string;
  totalKop: string;
  items: BankIncomingItem[];
};

export type IncomingReconciliationPreview = {
  dateFrom: string;
  dateTo: string;
  altegio: {
    totalKop: string;
    source: "db" | "live" | "mixed";
    byAccount: AltegioAccountAggregate[];
    stats?: {
      liveRows: number;
      dbRows: number;
      mergedRows: number;
    };
  };
  bank: {
    totalKop: string;
    byAccount: BankAccountAggregate[];
  };
  hints: {
    bankTypicallyNextDay: boolean;
    commissionPercent: number | null;
  };
};

type RawRecord = Record<string, unknown>;

const NO_PAYER_LABEL = "— без платника —";
/** Початок періоду вхідних у розділі «Платежі». */
export const INCOMING_RANGE_START_DATE = "2026-06-10";

function getKyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID is required for incoming aggregation");
  }
  return companyId;
}

function cleanText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMoneyNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function kopToString(value: bigint): string {
  return value.toString();
}

function sumKop(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, 0n);
}

export function kyivDayUtcRange(ymd: string): { from: Date; to: Date } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const from = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from, to };
}

export function parseBankCommission(text: string): { kopiykas: bigint | null; raw: string | null } {
  const match = text.match(/Комісія\s+банку\s+([\d\s]+(?:[,.]\d{1,2})?)\s*грн/i);
  if (!match) return { kopiykas: null, raw: null };
  const amountText = match[1].replace(/\s+/g, "").replace(",", ".");
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return { kopiykas: null, raw: match[0] };
  return { kopiykas: BigInt(Math.round(amount * 100)), raw: match[0] };
}

function collectPaymentMethodTexts(raw: unknown): string[] {
  const record = asRecord(raw);
  if (!record) return [];

  const texts: string[] = [];
  const visit = (value: unknown) => {
    const row = asRecord(value);
    if (!row) return;
    for (const key of ["title", "name", "slug", "type", "payment_type", "paymentType"]) {
      const text = cleanText(row[key]);
      if (text) texts.push(text.toLowerCase());
    }
    for (const key of ["payment_methods", "paymentMethods", "payment_method", "paymentMethod"]) {
      const direct = row[key];
      if (Array.isArray(direct)) direct.forEach(visit);
      else visit(direct);
    }
  };
  visit(record);
  return texts;
}

function isCashAccountTitle(accountTitle: string | null | undefined): boolean {
  const normalized = String(accountTitle || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "каса" || normalized.startsWith("каса ");
}

function isCashPaymentMethod(raw: unknown): boolean {
  const texts = collectPaymentMethodTexts(raw);
  if (texts.length === 0) return false;
  const cashMarkers = ["готів", "cash", "налич"];
  const cardMarkers = ["карт", "card", "безгот", "еквайр", "acquiring", "bank"];
  const hasCash = texts.some((text) => cashMarkers.some((marker) => text.includes(marker)));
  const hasCard = texts.some((text) => cardMarkers.some((marker) => text.includes(marker)));
  if (hasCard) return false;
  return hasCash;
}

function hasUnknownPaymentMethod(raw: unknown): boolean {
  return collectPaymentMethodTexts(raw).length === 0;
}

function getPayerNameFromRaw(raw: unknown, counterpartyName: string | null): string {
  if (counterpartyName) return counterpartyName;
  const record = asRecord(raw);
  if (!record) return NO_PAYER_LABEL;

  const client = asRecord(record.client) ?? asRecord(record.customer);
  const candidates = [
    record.client_name,
    record.clientName,
    record.customer_name,
    record.customerName,
    client?.name,
    client?.title,
    client?.display_name,
    client?.full_name,
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }
  return NO_PAYER_LABEL;
}

function detectDirectionFromRaw(raw: RawRecord, amountKop: bigint): string {
  const type = String(raw.type || "").toLowerCase();
  const typeId = String(raw.type_id || "").toLowerCase();
  if (type.includes("transfer") || type.includes("переміщ") || type.includes("перевод")) return "transfer";
  if (type.includes("expense") || raw.expense_id || raw.expense || typeId === "2") return "out";
  if (type.includes("income") || typeId === "1") return "in";
  if (amountKop < 0n) return "out";
  if (amountKop > 0n) return "in";
  return "unknown";
}

function normalizeLiveRow(raw: RawRecord): NormalizedAltegioIncomeRow | null {
  const altegioId = toInt(raw.id);
  if (!altegioId) return null;

  const amountKop = BigInt(Math.round(Math.abs(toMoneyNumber(raw.amount)) * 100));
  if (amountKop <= 0n) return null;

  const direction = detectDirectionFromRaw(raw, amountKop);
  if (direction !== "in") return null;

  const accountRecord = asRecord(raw.account);
  const accountTitle = cleanText(accountRecord?.title ?? accountRecord?.name) || "— без рахунку —";
  if (isCashAccountTitle(accountTitle)) return null;
  if (isCashPaymentMethod(raw)) return null;

  const counterpartyName = cleanText(
    raw.counterparty_name ??
      (asRecord(raw.counterparty)?.title) ??
      (asRecord(raw.counterparty)?.name) ??
      raw.supplier_name ??
      (asRecord(raw.supplier)?.title) ??
      (asRecord(raw.supplier)?.name),
  );

  return {
    altegioId,
    documentId: toInt(raw.document_id ?? raw.documentId ?? asRecord(raw.document)?.id),
    accountTitle,
    accountId: toInt(raw.account_id ?? accountRecord?.id) != null
      ? String(toInt(raw.account_id ?? accountRecord?.id))
      : null,
    payerName: getPayerNameFromRaw(raw, counterpartyName),
    amountKop,
    paymentPurpose: cleanText(
      raw.payment_purpose ??
        raw.paymentPurpose ??
        raw.purpose ??
        raw.comment ??
        asRecord(raw.expense)?.title ??
        asRecord(raw.expense)?.name,
    ),
    paymentMethodUnknown: hasUnknownPaymentMethod(raw),
    source: "live",
  };
}

function normalizeDbRow(row: {
  altegioId: number;
  documentId: number | null;
  accountTitle: string | null;
  accountId: string | null;
  counterpartyName: string | null;
  amountKopiykas: bigint;
  paymentPurpose: string | null;
  direction: string;
  expenseId: number | null;
  rawData: unknown;
}): NormalizedAltegioIncomeRow | null {
  const amountKop = row.amountKopiykas < 0n ? -row.amountKopiykas : row.amountKopiykas;
  if (amountKop <= 0n) return null;
  if (row.expenseId) return null;
  if (row.direction === "out" || row.direction === "transfer") return null;

  const accountTitle = row.accountTitle?.trim() || "— без рахунку —";
  if (isCashAccountTitle(accountTitle)) return null;
  if (isCashPaymentMethod(row.rawData) || isCashPaymentType(asRecord(row.rawData) ?? {})) return null;

  return {
    altegioId: row.altegioId,
    documentId: row.documentId,
    accountTitle,
    accountId: row.accountId,
    payerName: getPayerNameFromRaw(row.rawData, row.counterpartyName),
    amountKop,
    paymentPurpose: row.paymentPurpose,
    paymentMethodUnknown: hasUnknownPaymentMethod(row.rawData),
    source: "db",
  };
}

function unwrapArray(raw: unknown): RawRecord[] {
  if (Array.isArray(raw)) return raw.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
  const payload = asRecord(raw);
  if (!payload) return [];
  for (const key of ["data", "transactions", "items", "records"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
    }
    const nested = asRecord(value);
    if (nested) {
      for (const nestedKey of ["data", "items", "transactions"]) {
        const nestedValue = nested[nestedKey];
        if (Array.isArray(nestedValue)) {
          return nestedValue.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
        }
      }
    }
  }
  return [];
}

function normalizePaymentsApiRow(raw: RawRecord): NormalizedAltegioIncomeRow | null {
  const altegioId = toInt(raw.id ?? raw.transaction_id);
  if (!altegioId) return null;

  const amountKop = BigInt(Math.round(Math.abs(toMoneyNumber(raw.amount ?? raw.sum ?? raw.paid_sum)) * 100));
  if (amountKop <= 0n) return null;

  // Витрати з expense_id не є вхідними оплатами клієнтів.
  if (toInt(raw.expense_id ?? raw.expenseId ?? asRecord(raw.expense)?.id)) return null;

  const direction = detectDirectionFromRaw(raw, amountKop);
  if (direction === "out" || direction === "transfer") return null;

  const accountRecord = asRecord(raw.account) ?? asRecord(raw.cashbox) ?? asRecord(raw.cash_box);
  const accountTitle =
    cleanText(
      accountRecord?.title ??
        accountRecord?.name ??
        raw.account_title ??
        raw.cashbox_title ??
        raw.cash_box_title,
    ) || "— без рахунку —";
  if (isCashAccountTitle(accountTitle)) return null;
  if (isCashPaymentMethod(raw) || isCashPaymentType(raw)) return null;

  const clientRecord = asRecord(raw.client) ?? asRecord(raw.customer);
  const counterpartyName = cleanText(
    clientRecord?.name ??
      clientRecord?.title ??
      clientRecord?.display_name ??
      clientRecord?.full_name ??
      raw.client_name ??
      raw.clientName ??
      raw.customer_name,
  );

  return {
    altegioId,
    documentId: toInt(raw.document_id ?? raw.documentId ?? asRecord(raw.document)?.id),
    accountTitle,
    accountId:
      toInt(raw.account_id ?? raw.cashbox_id ?? accountRecord?.id) != null
        ? String(toInt(raw.account_id ?? raw.cashbox_id ?? accountRecord?.id))
        : null,
    payerName: getPayerNameFromRaw(raw, counterpartyName),
    amountKop,
    paymentPurpose: cleanText(
      raw.payment_purpose ??
        raw.paymentPurpose ??
        raw.purpose ??
        raw.comment ??
        raw.title ??
        raw.service_name,
    ),
    paymentMethodUnknown: hasUnknownPaymentMethod(raw) && !hasPaymentTypeHint(raw),
    source: "live",
  };
}

function isCashPaymentType(raw: RawRecord): boolean {
  const paymentType = asRecord(raw.payment_type) ?? asRecord(raw.payed_type) ?? asRecord(raw.pay_type);
  const texts = [
    raw.payment_type,
    raw.payment_type_title,
    raw.payed_type,
    raw.pay_type,
    raw.payment_method,
    paymentType?.title,
    paymentType?.name,
    paymentType?.slug,
  ]
    .map((value) => cleanText(value)?.toLowerCase())
    .filter((value): value is string => Boolean(value));

  if (texts.length === 0) return false;
  const cashMarkers = ["готів", "cash", "налич"];
  const cardMarkers = ["карт", "card", "безгот", "еквайр", "acquiring", "bank", "банк"];
  const hasCash = texts.some((text) => cashMarkers.some((marker) => text.includes(marker)));
  const hasCard = texts.some((text) => cardMarkers.some((marker) => text.includes(marker)));
  if (hasCard) return false;
  return hasCash;
}

function hasPaymentTypeHint(raw: RawRecord): boolean {
  return Boolean(
    raw.payment_type ||
      raw.payment_type_title ||
      raw.payed_type ||
      raw.pay_type ||
      asRecord(raw.payment_type)?.title,
  );
}

async function fetchPaymentsApiIncomeRows(dateFrom: string, dateTo: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const count = 1000;
  const maxPages = 30;
  const byId = new Map<number, NormalizedAltegioIncomeRow>();

  const paramVariants: URLSearchParams[] = [
    new URLSearchParams({
      start_date: dateFrom,
      end_date: dateTo,
      balance_is: "1",
      deleted: "0",
      count: String(count),
    }),
    new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
      balance_is: "1",
      deleted: "0",
      count: String(count),
    }),
    new URLSearchParams({
      start_date: dateFrom,
      end_date: dateTo,
      real_money: "1",
      deleted: "0",
      count: String(count),
    }),
  ];

  for (const baseParams of paramVariants) {
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams(baseParams);
        params.set("page", String(page));
        const path = `/transactions/${companyId}?${params.toString()}`;
        const raw = await altegioFetch<unknown>(path);
        const pageRows = unwrapArray(raw);
        for (const pageRow of pageRows) {
          const normalized = normalizePaymentsApiRow(pageRow);
          if (normalized) byId.set(normalized.altegioId, normalized);
        }
        if (pageRows.length < count) break;
      }
      if (byId.size > 0) {
        console.log("[incoming-altegio-aggregate] Payments API", {
          dateFrom,
          dateTo,
          rows: byId.size,
          params: baseParams.toString(),
        });
        return Array.from(byId.values());
      }
    } catch (error) {
      console.warn("[incoming-altegio-aggregate] Payments API не вдався", {
        dateFrom,
        dateTo,
        params: baseParams.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Array.from(byId.values());
}

async function fetchLiveIncomeRowsRange(dateFrom: string, dateTo: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const count = 1000;
  const maxPages = 30;
  const byId = new Map<number, NormalizedAltegioIncomeRow>();

  const paymentsRows = await fetchPaymentsApiIncomeRows(dateFrom, dateTo);
  for (const row of paymentsRows) byId.set(row.altegioId, row);

  const attempts: Array<{ method: "GET" | "POST"; path: string; body?: Record<string, unknown>; params?: URLSearchParams }> = [
    {
      method: "POST",
      path: `/company/${companyId}/finance_transactions/search`,
      body: { start_date: dateFrom, end_date: dateTo, deleted: false, count, page: 1 },
    },
    {
      method: "GET",
      path: `/transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: dateFrom,
        end_date: dateTo,
        deleted: "0",
        count: String(count),
        page: "1",
      }),
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const path =
          attempt.method === "GET" && attempt.params
            ? `${attempt.path}?${new URLSearchParams({ ...Object.fromEntries(attempt.params), page: String(page) }).toString()}`
            : attempt.path;
        const raw = await altegioFetch<unknown>(
          path,
          attempt.method === "POST"
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...attempt.body, page }),
              }
            : {},
        );
        const pageRows = unwrapArray(raw);
        for (const pageRow of pageRows) {
          const normalized = normalizeLiveRow(pageRow) ?? normalizePaymentsApiRow(pageRow);
          if (normalized) byId.set(normalized.altegioId, normalized);
        }
        if (pageRows.length < count) break;
      }
    } catch (error) {
      lastError = error;
      console.warn("[incoming-altegio-aggregate] Live fetch не вдався", {
        dateFrom,
        dateTo,
        path: attempt.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (byId.size > 0) {
    console.log("[incoming-altegio-aggregate] Live fetch сумарно", {
      dateFrom,
      dateTo,
      rows: byId.size,
    });
    return Array.from(byId.values());
  }

  if (lastError) {
    console.warn("[incoming-altegio-aggregate] Live fetch: порожньо після всіх спроб", { dateFrom, dateTo });
  }
  return [];
}

async function fetchDbIncomeRowsRange(dateFrom: string, dateTo: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const dbRows = await (prisma as any).altegioFinanceTransaction.findMany({
    where: {
      companyId,
      kyivDay: { gte: dateFrom, lte: dateTo },
      deletedInAltegio: false,
      amountKopiykas: { gt: 0 },
      expenseId: null,
      direction: { notIn: ["out", "transfer"] },
    },
    select: {
      altegioId: true,
      documentId: true,
      accountTitle: true,
      accountId: true,
      counterpartyName: true,
      amountKopiykas: true,
      paymentPurpose: true,
      direction: true,
      expenseId: true,
      rawData: true,
    },
    orderBy: [{ accountTitle: "asc" }, { counterpartyName: "asc" }],
  });

  const normalized: NormalizedAltegioIncomeRow[] = [];
  for (const row of dbRows) {
    const item = normalizeDbRow(row);
    if (item) normalized.push(item);
  }
  return normalized;
}

export function aggregateAltegioByAccountAndClient(rows: NormalizedAltegioIncomeRow[]): {
  byAccount: AltegioAccountAggregate[];
  totalKop: bigint;
  source: "db" | "live" | "mixed";
} {
  const accountMap = new Map<string, Map<string, NormalizedAltegioIncomeRow[]>>();
  let source: "db" | "live" | "mixed" = "db";
  let sawDb = false;
  let sawLive = false;

  for (const row of rows) {
    if (row.source === "live") sawLive = true;
    if (row.source === "db") sawDb = true;
    const accountKey = `${row.accountId || ""}|${row.accountTitle}`;
    if (!accountMap.has(accountKey)) accountMap.set(accountKey, new Map());
    const clientMap = accountMap.get(accountKey)!;
    const payerKey = row.payerName.toLowerCase();
    if (!clientMap.has(payerKey)) clientMap.set(payerKey, []);
    clientMap.get(payerKey)!.push(row);
  }

  if (sawDb && sawLive) source = "mixed";
  else if (sawLive) source = "live";
  else source = "db";

  const byAccount: AltegioAccountAggregate[] = [];
  let totalKop = 0n;

  for (const [accountKey, clientMap] of accountMap.entries()) {
    const sample = clientMap.values().next().value?.[0];
    const accountTitle = sample?.accountTitle || accountKey.split("|")[1] || "—";
    const accountId = sample?.accountId ?? null;
    const byClient: AltegioClientAggregate[] = [];
    let accountTotal = 0n;

    for (const clientRows of clientMap.values()) {
      const payerName = clientRows[0]?.payerName || NO_PAYER_LABEL;
      const clientTotal = sumKop(clientRows.map((item) => item.amountKop));
      accountTotal += clientTotal;
      byClient.push({
        payerName,
        totalKop: kopToString(clientTotal),
        transactionCount: clientRows.length,
        items: clientRows.map((item) => ({
          altegioId: item.altegioId,
          documentId: item.documentId,
          amountKop: kopToString(item.amountKop),
          paymentPurpose: item.paymentPurpose,
          paymentMethodUnknown: item.paymentMethodUnknown,
        })),
      });
    }

    byClient.sort((a, b) => a.payerName.localeCompare(b.payerName, "uk"));
    totalKop += accountTotal;
    byAccount.push({
      accountTitle,
      accountId,
      totalKop: kopToString(accountTotal),
      byClient,
    });
  }

  byAccount.sort((a, b) => a.accountTitle.localeCompare(b.accountTitle, "uk"));
  return { byAccount, totalKop, source };
}

export function classifyIncomingBankRow(params: {
  description: string;
  comment: string | null;
  counterName: string | null;
}): IncomingBankRowKind {
  const text = `${params.description} ${params.comment || ""} ${params.counterName || ""}`.toLowerCase();
  if (
    (text.includes("універсал") || text.includes("universal")) &&
    (text.includes("покриття") || text.includes("транзакц") || text.includes("еквайр"))
  ) {
    return "universal_bank_aggregate";
  }
  if (/від:\s*[\p{L}'\s.-]{3,}/iu.test(text) || (params.counterName && !params.counterName.toLowerCase().includes("банк"))) {
    return "named_incoming";
  }
  return "unknown";
}

function bankAccountLabel(account: {
  id: string;
  altegioAccountTitle: string | null;
  maskedPan: string | null;
  iban: string | null;
  connection?: { clientName: string | null; name: string | null } | null;
}): string {
  const last4 = (account.maskedPan || account.iban || "").replace(/\s+/g, "").slice(-4);
  const fop = account.connection?.clientName || account.connection?.name || account.altegioAccountTitle || "Рахунок";
  return last4 ? `${fop} (${last4})` : fop;
}

async function fetchBankIncomingByAccountRange(dateFrom: string, dateTo: string): Promise<{
  byAccount: BankAccountAggregate[];
  totalKop: bigint;
}> {
  const { from } = kyivDayUtcRange(dateFrom);
  const { to } = kyivDayUtcRange(dateTo);
  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from, lte: to },
      amount: { gt: 0n },
      account: { includeInOperationsTable: true },
    },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
          connection: { select: { clientName: true, name: true } },
        },
      },
    },
    orderBy: [{ time: "desc" }],
  });

  const accountMap = new Map<string, BankIncomingItem[]>();
  const accountLabels = new Map<string, string>();

  for (const statement of statements) {
    const accountId = statement.account.id;
    const label = bankAccountLabel(statement.account);
    accountLabels.set(accountId, label);
    const text = `${statement.description || ""} ${statement.comment || ""}`;
    const commission = parseBankCommission(text);
    const item: BankIncomingItem = {
      id: statement.id,
      time: statement.time.toISOString(),
      amountKop: statement.amount.toString(),
      description: statement.description,
      comment: statement.comment,
      counterName: statement.counterName,
      kind: classifyIncomingBankRow({
        description: statement.description,
        comment: statement.comment,
        counterName: statement.counterName,
      }),
      commissionKop: commission.kopiykas != null ? commission.kopiykas.toString() : null,
      commissionRaw: commission.raw,
    };
    if (!accountMap.has(accountId)) accountMap.set(accountId, []);
    accountMap.get(accountId)!.push(item);
  }

  const byAccount: BankAccountAggregate[] = [];
  let totalKop = 0n;

  for (const [accountId, items] of accountMap.entries()) {
    const accountTotal = sumKop(items.map((item) => BigInt(item.amountKop)));
    totalKop += accountTotal;
    byAccount.push({
      accountLabel: accountLabels.get(accountId) || "Рахунок",
      accountId,
      totalKop: kopToString(accountTotal),
      items,
    });
  }

  byAccount.sort((a, b) => a.accountLabel.localeCompare(b.accountLabel, "uk"));
  return { byAccount, totalKop };
}

function mergeIncomeRows(liveRows: NormalizedAltegioIncomeRow[], dbRows: NormalizedAltegioIncomeRow[]): NormalizedAltegioIncomeRow[] {
  const byId = new Map<number, NormalizedAltegioIncomeRow>();
  for (const row of liveRows) byId.set(row.altegioId, row);
  for (const row of dbRows) {
    if (!byId.has(row.altegioId)) byId.set(row.altegioId, row);
  }
  return Array.from(byId.values());
}

export async function buildIncomingReconciliationPreview(): Promise<IncomingReconciliationPreview> {
  const dateFrom = INCOMING_RANGE_START_DATE;
  const dateTo = getKyivTodayYmd();

  const [liveRows, dbRows, bankAgg] = await Promise.all([
    fetchLiveIncomeRowsRange(dateFrom, dateTo),
    fetchDbIncomeRowsRange(dateFrom, dateTo),
    fetchBankIncomingByAccountRange(dateFrom, dateTo),
  ]);

  const incomeRows = mergeIncomeRows(liveRows, dbRows);
  const altegioAgg = aggregateAltegioByAccountAndClient(incomeRows);

  const commissionPercentRaw = process.env.ALTEGIO_ACQUIRING_COMMISSION_PERCENT?.trim();
  const commissionPercent = commissionPercentRaw ? Number(commissionPercentRaw) : null;

  console.log("[incoming-altegio-aggregate] Preview", {
    dateFrom,
    dateTo,
    liveRows: liveRows.length,
    dbRows: dbRows.length,
    mergedRows: incomeRows.length,
    altegioAccounts: altegioAgg.byAccount.length,
    bankAccounts: bankAgg.byAccount.length,
    source: altegioAgg.source,
    syncStartDate: ALTEGIO_FINANCE_SYNC_START_DATE,
  });

  return {
    dateFrom,
    dateTo,
    altegio: {
      totalKop: kopToString(altegioAgg.totalKop),
      source: altegioAgg.source,
      byAccount: altegioAgg.byAccount,
      stats: {
        liveRows: liveRows.length,
        dbRows: dbRows.length,
        mergedRows: incomeRows.length,
      },
    },
    bank: {
      totalKop: kopToString(bankAgg.totalKop),
      byAccount: bankAgg.byAccount,
    },
    hints: {
      bankTypicallyNextDay: true,
      commissionPercent: Number.isFinite(commissionPercent) ? commissionPercent : null,
    },
  };
}
