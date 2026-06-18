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
  kyivDay: string;
  altegio: {
    totalKop: string;
    source: "db" | "live" | "mixed";
    byAccount: AltegioAccountAggregate[];
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
const DEFAULT_KYIV_DAY = "2026-06-10";

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

export function normalizeKyivDayInput(value: string | null | undefined): string {
  const raw = (value || DEFAULT_KYIV_DAY).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(raw)) {
    const [dd, mm, yy] = raw.split(".");
    return `20${yy}-${mm}-${dd}`;
  }
  return DEFAULT_KYIV_DAY;
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
  rawData: unknown;
}): NormalizedAltegioIncomeRow | null {
  const amountKop = row.amountKopiykas < 0n ? -row.amountKopiykas : row.amountKopiykas;
  if (amountKop <= 0n) return null;

  const accountTitle = row.accountTitle?.trim() || "— без рахунку —";
  if (isCashAccountTitle(accountTitle)) return null;
  if (isCashPaymentMethod(row.rawData)) return null;

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

async function fetchLiveIncomeRows(kyivDay: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const rows: NormalizedAltegioIncomeRow[] = [];
  const count = 1000;

  const attempts: Array<{ method: "GET" | "POST"; path: string; body?: Record<string, unknown>; params?: URLSearchParams }> = [
    {
      method: "POST",
      path: `/company/${companyId}/finance_transactions/search`,
      body: { start_date: kyivDay, end_date: kyivDay, deleted: false, count, page: 1 },
    },
    {
      method: "GET",
      path: `/transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: kyivDay,
        end_date: kyivDay,
        deleted: "0",
        count: String(count),
        page: "1",
      }),
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      for (let page = 1; page <= 10; page += 1) {
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
          const normalized = normalizeLiveRow(pageRow);
          if (normalized) rows.push(normalized);
        }
        if (pageRows.length < count) break;
      }
      if (rows.length > 0) {
        console.log("[incoming-altegio-aggregate] Live fetch Altegio", { kyivDay, rows: rows.length, path: attempt.path });
        return rows;
      }
    } catch (error) {
      lastError = error;
      console.warn("[incoming-altegio-aggregate] Live fetch не вдався", {
        kyivDay,
        path: attempt.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (lastError) {
    console.warn("[incoming-altegio-aggregate] Live fetch: порожньо після всіх спроб", { kyivDay });
  }
  return rows;
}

async function fetchDbIncomeRows(kyivDay: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const dbRows = await (prisma as any).altegioFinanceTransaction.findMany({
    where: {
      companyId,
      kyivDay,
      direction: "in",
      deletedInAltegio: false,
      amountKopiykas: { gt: 0 },
    },
    select: {
      altegioId: true,
      documentId: true,
      accountTitle: true,
      accountId: true,
      counterpartyName: true,
      amountKopiykas: true,
      paymentPurpose: true,
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

async function fetchBankIncomingByAccount(kyivDay: string): Promise<{
  byAccount: BankAccountAggregate[];
  totalKop: bigint;
}> {
  const { from, to } = kyivDayUtcRange(kyivDay);
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

export async function buildIncomingReconciliationPreview(kyivDayInput: string): Promise<IncomingReconciliationPreview> {
  const kyivDay = normalizeKyivDayInput(kyivDayInput);
  let incomeRows = await fetchDbIncomeRows(kyivDay);

  if (incomeRows.length === 0 || kyivDay < ALTEGIO_FINANCE_SYNC_START_DATE) {
    const liveRows = await fetchLiveIncomeRows(kyivDay);
    if (liveRows.length > 0) {
      const seen = new Set(incomeRows.map((row) => row.altegioId));
      for (const row of liveRows) {
        if (!seen.has(row.altegioId)) incomeRows.push(row);
      }
    }
  }

  const altegioAgg = aggregateAltegioByAccountAndClient(incomeRows);
  const bankAgg = await fetchBankIncomingByAccount(kyivDay);

  const commissionPercentRaw = process.env.ALTEGIO_ACQUIRING_COMMISSION_PERCENT?.trim();
  const commissionPercent = commissionPercentRaw ? Number(commissionPercentRaw) : null;

  console.log("[incoming-altegio-aggregate] Preview", {
    kyivDay,
    altegioRows: incomeRows.length,
    altegioAccounts: altegioAgg.byAccount.length,
    bankAccounts: bankAgg.byAccount.length,
    source: altegioAgg.source,
  });

  return {
    kyivDay,
    altegio: {
      totalKop: kopToString(altegioAgg.totalKop),
      source: altegioAgg.source,
      byAccount: altegioAgg.byAccount,
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
