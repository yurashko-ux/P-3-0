import { prisma } from "@/lib/prisma";
import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";
import { fetchExpenseCategories } from "./expenses";
import {
  extractPaymentMethodBalanceKopiykas,
  recalculateAltegioFinanceTransactionBalances,
} from "./finance-transaction-balances";
import { normalizePaymentPurposeTitle } from "./finance-transactions-sync";

const CREATE_FINANCE_TRANSACTION_ENDPOINT = "POST /finance_transactions/{locationId}";
const FINANCE_EXPENSE_LOOKUP_START_DATE = "2026-06-15";

type RawRecord = Record<string, unknown>;

type CreateFinanceTransactionPayload = {
  account_id: number;
  amount: number;
  date: string;
  expense_id?: number;
  comment?: string;
};

export type CreatedAltegioFinanceTransaction = {
  id: string;
  altegioId: number;
  amountKopiykas: bigint;
  accountId: string | null;
  accountTitle: string | null;
  direction: string;
  operationDate: Date;
  comment: string | null;
};

export type CreateAltegioExpenseFromPendingResult = {
  transaction: CreatedAltegioFinanceTransaction;
  reusedExisting: boolean;
};

export type CreateAltegioTransferFromPendingResult = {
  sourceTransaction: CreatedAltegioFinanceTransaction;
  targetTransaction: CreatedAltegioFinanceTransaction;
  reusedExisting: boolean;
};

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для створення фінансових операцій Altegio");
  }
  return companyId;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMoneyNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toKopiykas(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function kopiykasToMoney(value: bigint): number {
  return Number(value) / 100;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function kyivDayFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function altegioKyivDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

function purposeAliasKeys(value: string): Set<string> {
  const normalized = normalizePaymentPurposeTitle(value);
  const keys = new Set([normalized]);
  if (
    normalized.includes("подат") ||
    normalized.includes("збор") ||
    normalized.includes("tax") ||
    normalized.includes("налог")
  ) {
    keys.add("податки");
    keys.add("податки та збори");
    keys.add("taxes");
    keys.add("taxes and fees");
  }
  return keys;
}

function purposeTokens(value: string): Set<string> {
  return new Set(
    normalizePaymentPurposeTitle(value)
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function scorePurposeTitleMatch(target: string, candidate: string): number {
  const targetAliases = purposeAliasKeys(target);
  const candidateAliases = purposeAliasKeys(candidate);
  for (const key of targetAliases) {
    if (candidateAliases.has(key)) return 100;
  }

  const targetTokens = purposeTokens(target);
  const candidateTokens = purposeTokens(candidate);
  if (!targetTokens.size || !candidateTokens.size) return 0;

  let overlap = 0;
  for (const token of targetTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return Math.round((overlap / Math.min(targetTokens.size, candidateTokens.size)) * 80);
}

function unwrapCreatedTransaction(raw: unknown): RawRecord | null {
  const root = asRecord(raw);
  if (!root) return null;
  if (toInt(root.id)) return root;

  const data = root.data;
  if (Array.isArray(data)) {
    return asRecord(data[0]);
  }
  const dataRecord = asRecord(data);
  if (!dataRecord) return null;
  if (toInt(dataRecord.id)) return dataRecord;
  if (Array.isArray(dataRecord.data)) {
    return asRecord(dataRecord.data[0]);
  }
  return asRecord(dataRecord.data) ?? asRecord(dataRecord.transaction) ?? null;
}

function getExpenseTitle(raw: RawRecord | null, fallback?: string | null): string | null {
  const expense = asRecord(raw?.expense);
  return cleanText(expense?.title ?? expense?.name ?? raw?.payment_purpose ?? raw?.purpose ?? fallback);
}

function getAccountTitle(raw: RawRecord | null, fallback?: string | null): string | null {
  const account = asRecord(raw?.account);
  return cleanText(account?.title ?? account?.name ?? raw?.account_title ?? fallback);
}

function getAccountId(raw: RawRecord | null, fallback?: string | null): string | null {
  const account = asRecord(raw?.account);
  const value = raw?.account_id ?? raw?.accountId ?? account?.id ?? fallback;
  return value == null ? null : String(value);
}

function getComment(raw: RawRecord | null, fallback?: string | null): string | null {
  return cleanText(raw?.comment ?? fallback);
}

function getDocumentId(raw: RawRecord | null): number | null {
  const document = asRecord(raw?.document);
  return toInt(raw?.document_id ?? raw?.documentId ?? document?.id ?? document?.document_id);
}

/** Рядок для коментаря Altegio: дата/час операції в monobank (київський час). */
export function formatBankPaymentDateLine(operationTime: Date): string {
  const formatted = operationTime.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Дата банківського платежу: ${formatted}`;
}

/** Рядок для коментаря Altegio: залишок monobank після операції (копійки → грн). */
export function formatBankBalanceAfterOperationLine(balanceKopiykas: bigint | null | undefined): string | null {
  if (balanceKopiykas == null) return null;
  const formatted = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(balanceKopiykas) / 100);
  return `Залишок на банківському рахунку після операції: ${formatted} ₴`;
}

export function appendBankBalanceToAltegioComment(
  comment: string | null | undefined,
  balanceKopiykas: bigint | null | undefined,
): string | null {
  const balanceLine = formatBankBalanceAfterOperationLine(balanceKopiykas);
  const base = cleanText(comment);
  if (!balanceLine) return base;
  return base ? `${base}\n\n${balanceLine}` : balanceLine;
}

function buildBankStatementComment(statement: {
  time: Date;
  counterName?: string | null;
  comment?: string | null;
  description?: string | null;
  balance?: bigint | null;
}): string | null {
  const lines = [
    formatBankPaymentDateLine(statement.time),
    statement.counterName ? `Контрагент: ${statement.counterName}` : null,
    statement.comment ? `Призначення банку: ${statement.comment}` : null,
    statement.description ? `Опис: ${statement.description}` : null,
    formatBankBalanceAfterOperationLine(statement.balance),
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : null;
}

function getOperationDate(raw: RawRecord | null, fallback: Date): Date {
  const text = cleanText(raw?.date ?? raw?.created_at ?? raw?.create_date);
  if (!text) return fallback;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function getAmountKopiykas(raw: RawRecord | null, fallbackAmount: number): bigint {
  const amount = toMoneyNumber(raw?.amount);
  return toKopiykas(amount ?? fallbackAmount);
}

function getRawJson(raw: unknown): object {
  return asRecord(raw) ?? { value: raw == null ? null : String(raw) };
}

function unwrapArray(raw: unknown): RawRecord[] {
  if (Array.isArray(raw)) return raw.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
  const record = asRecord(raw);
  if (!record) return [];
  const direct = record.data ?? record.transactions ?? record.items;
  if (Array.isArray(direct)) return direct.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
  const nested = asRecord(record.data);
  if (!nested) return [];
  const nestedRows = nested.data ?? nested.items ?? nested.transactions;
  return Array.isArray(nestedRows)
    ? nestedRows.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null)
    : [];
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchRecentFinanceTransactionRows(companyId: string): Promise<RawRecord[]> {
  const dateTo = todayYmd();
  const attempts = [
    `/transactions/${companyId}?${new URLSearchParams({
      start_date: FINANCE_EXPENSE_LOOKUP_START_DATE,
      end_date: dateTo,
      deleted: "0",
      count: "1000",
      page: "1",
    }).toString()}`,
    `/finance_transactions/${companyId}?${new URLSearchParams({
      start_date: FINANCE_EXPENSE_LOOKUP_START_DATE,
      end_date: dateTo,
      deleted: "0",
      count: "1000",
      page: "1",
    }).toString()}`,
    `/transactions/${companyId}?${new URLSearchParams({
      date_from: FINANCE_EXPENSE_LOOKUP_START_DATE,
      date_to: dateTo,
      deleted: "0",
      count: "1000",
      page: "1",
    }).toString()}`,
  ];

  for (const path of attempts) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const rows = unwrapArray(raw);
      if (rows.length > 0) {
        console.log("[altegio/finance-create] Отримано фінансові транзакції для пошуку expense_id", {
          path,
          rows: rows.length,
        });
        return rows;
      }
    } catch (error) {
      console.warn("[altegio/finance-create] Не вдалося отримати транзакції для пошуку expense_id:", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return [];
}

async function createAltegioFinanceTransactionRaw(params: {
  companyId: string;
  payload: CreateFinanceTransactionPayload;
}): Promise<unknown> {
  return altegioFetch<unknown>(`/finance_transactions/${params.companyId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.payload),
  });
}

async function upsertCreatedFinanceTransaction(params: {
  companyId: string;
  raw: unknown;
  fallback: {
    accountId: string | null;
    accountTitle: string | null;
    amount: number;
    date: Date;
    direction: string;
    expenseId?: number | null;
    purposeTitle?: string | null;
    comment?: string | null;
  };
}): Promise<CreatedAltegioFinanceTransaction> {
  const row = unwrapCreatedTransaction(params.raw);
  const altegioId = toInt(row?.id);
  if (!altegioId) {
    throw new Error("Altegio створив транзакцію, але не повернув її id");
  }

  const operationDate = getOperationDate(row, params.fallback.date);
  const amountKopiykas = getAmountKopiykas(row, params.fallback.amount);
  const accountId = getAccountId(row, params.fallback.accountId);
  const accountTitle = getAccountTitle(row, params.fallback.accountTitle);
  const expenseId = toInt(row?.expense_id ?? asRecord(row?.expense)?.id) ?? params.fallback.expenseId ?? null;
  const paymentPurpose = getExpenseTitle(row, params.fallback.purposeTitle);
  const comment = getComment(row, params.fallback.comment);
  const accountBalanceAfterKopiykas = extractPaymentMethodBalanceKopiykas(params.raw, accountId);

  const saved = await (prisma as any).altegioFinanceTransaction.upsert({
    where: { companyId_altegioId: { companyId: params.companyId, altegioId } },
    create: {
      altegioId,
      companyId: params.companyId,
      accountId,
      accountTitle,
      documentId: getDocumentId(row),
      expenseId,
      operationDate,
      kyivDay: kyivDayFromDate(operationDate),
      amountKopiykas,
      accountBalanceAfterKopiykas,
      direction: params.fallback.direction,
      categoryTitle: paymentPurpose,
      paymentPurpose,
      comment,
      counterpartyName: cleanText(row?.counterparty_name ?? asRecord(row?.counterparty)?.name),
      sourceEndpoint: CREATE_FINANCE_TRANSACTION_ENDPOINT,
      rawData: getRawJson(params.raw),
      deletedInAltegio: false,
      syncedAt: new Date(),
    },
    update: {
      accountId,
      accountTitle,
      documentId: getDocumentId(row),
      expenseId,
      operationDate,
      kyivDay: kyivDayFromDate(operationDate),
      amountKopiykas,
      accountBalanceAfterKopiykas,
      direction: params.fallback.direction,
      categoryTitle: paymentPurpose,
      paymentPurpose,
      comment,
      counterpartyName: cleanText(row?.counterparty_name ?? asRecord(row?.counterparty)?.name),
      sourceEndpoint: CREATE_FINANCE_TRANSACTION_ENDPOINT,
      rawData: getRawJson(params.raw),
      deletedInAltegio: false,
      syncedAt: new Date(),
    },
    select: {
      id: true,
      altegioId: true,
      amountKopiykas: true,
      accountId: true,
      accountTitle: true,
      direction: true,
      operationDate: true,
      comment: true,
    },
  });

  return saved;
}

async function findExistingLocalTransaction(params: {
  accountId: string;
  amountKopiykas: bigint;
  operationDate: Date;
  direction: string;
  purposeTitle?: string | null;
  comment?: string | null;
}): Promise<CreatedAltegioFinanceTransaction | null> {
  const where: any = {
    accountId: params.accountId,
    direction: params.direction,
    deletedInAltegio: false,
    operationDate: { gte: addDays(params.operationDate, -2), lte: addDays(params.operationDate, 2) },
    OR: [{ amountKopiykas: params.amountKopiykas }, { amountKopiykas: -params.amountKopiykas }],
  };

  const textOr: any[] = [];
  if (params.comment) {
    textOr.push({ comment: params.comment });
  }
  if (params.purposeTitle) {
    textOr.push({ paymentPurpose: params.purposeTitle }, { categoryTitle: params.purposeTitle });
  }
  if (textOr.length > 0) {
    where.AND = [{ OR: textOr }];
  }

  return (prisma as any).altegioFinanceTransaction.findFirst({
    where,
    orderBy: { operationDate: "desc" },
    select: {
      id: true,
      altegioId: true,
      amountKopiykas: true,
      accountId: true,
      accountTitle: true,
      direction: true,
      operationDate: true,
      comment: true,
    },
  });
}

async function linkBankPaymentToAltegioTransaction(params: {
  bankStatementItemId: string;
  altegioFinanceTransactionId: string;
  reviewNote: string;
}) {
  const match = await (prisma as any).bankAltegioPaymentMatch.upsert({
    where: { bankStatementItemId: params.bankStatementItemId },
    create: {
      bankStatementItemId: params.bankStatementItemId,
      altegioFinanceTransactionId: params.altegioFinanceTransactionId,
      status: "manual_matched",
      matchType: "telegram",
      matchScore: 100,
      matchedAt: new Date(),
      matchedBy: "telegram_altegio_create",
      reviewNote: params.reviewNote,
    },
    update: {
      altegioFinanceTransactionId: params.altegioFinanceTransactionId,
      status: "manual_matched",
      matchType: "telegram",
      matchScore: 100,
      matchedAt: new Date(),
      matchedBy: "telegram_altegio_create",
      reviewNote: params.reviewNote,
    },
    select: { id: true },
  });

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: { status: "linked", linkedMatchId: match.id },
  }).catch(() => null);

  return match;
}

async function resolveExpenseIdForPendingPurpose(pending: any, companyId: string): Promise<number | null> {
  const existingId = toInt(pending.purpose?.externalId);
  if (existingId) return existingId;

  const targetTitle = cleanText(pending.purposeTitle);
  const targetNormalized = normalizePaymentPurposeTitle(targetTitle || "");
  if (!targetNormalized) return null;

  const localPurpose = await (prisma as any).altegioPaymentPurpose.findFirst({
    where: {
      companyId,
      normalizedTitle: targetNormalized,
      externalId: { not: null },
    },
    select: { externalId: true },
  });
  const localId = toInt(localPurpose?.externalId);
  if (localId) return localId;

  const historicalRows = await (prisma as any).altegioFinanceTransaction.findMany({
    where: {
      companyId,
      expenseId: { not: null },
    },
    select: {
      expenseId: true,
      paymentPurpose: true,
      categoryTitle: true,
      rawData: true,
    },
    orderBy: { operationDate: "desc" },
    take: 1000,
  });

  let bestHistoricalMatch: { title: string; externalId: number; score: number; rawData: unknown } | null = null;
  for (const row of historicalRows) {
    const raw = asRecord(row.rawData);
    const rawExpense = asRecord(raw?.expense);
    const title = cleanText(
      rawExpense?.title ||
        rawExpense?.name ||
        row.paymentPurpose ||
        row.categoryTitle,
    );
    const externalId = toInt(row.expenseId ?? rawExpense?.id);
    if (!title || !externalId) continue;
    const score = scorePurposeTitleMatch(targetTitle || "", title);
    if (!bestHistoricalMatch || score > bestHistoricalMatch.score) {
      bestHistoricalMatch = { title, externalId, score, rawData: row.rawData };
    }
  }

  if (bestHistoricalMatch && bestHistoricalMatch.score >= 80) {
    await (prisma as any).altegioPaymentPurpose.upsert({
      where: { companyId_normalizedTitle: { companyId, normalizedTitle: targetNormalized } },
      create: {
        companyId,
        externalId: String(bestHistoricalMatch.externalId),
        title: targetTitle || bestHistoricalMatch.title,
        normalizedTitle: targetNormalized,
        source: "finance_transaction_expense",
        rawData: asRecord(bestHistoricalMatch.rawData) ?? { title: bestHistoricalMatch.title },
        isActive: true,
        syncedAt: new Date(),
      },
      update: {
        externalId: String(bestHistoricalMatch.externalId),
        title: targetTitle || bestHistoricalMatch.title,
        source: "finance_transaction_expense",
        rawData: asRecord(bestHistoricalMatch.rawData) ?? { title: bestHistoricalMatch.title },
        isActive: true,
        syncedAt: new Date(),
      },
    });
    return bestHistoricalMatch.externalId;
  }

  const liveRows = await fetchRecentFinanceTransactionRows(companyId);
  let bestLiveMatch: { title: string; externalId: number; score: number; rawData: unknown } | null = null;
  const liveTitles: string[] = [];
  for (const row of liveRows) {
    const expense = asRecord(row.expense);
    const title = cleanText(
      expense?.title ||
        expense?.name ||
        row.payment_purpose ||
        row.paymentPurpose ||
        row.purpose ||
        row.comment,
    );
    const externalId = toInt(row.expense_id ?? expense?.id);
    if (!title || !externalId) continue;
    if (liveTitles.length < 12) liveTitles.push(title);
    const score = scorePurposeTitleMatch(targetTitle || "", title);
    if (!bestLiveMatch || score > bestLiveMatch.score) {
      bestLiveMatch = { title, externalId, score, rawData: row };
    }
  }

  if (bestLiveMatch && bestLiveMatch.score >= 80) {
    await (prisma as any).altegioPaymentPurpose.upsert({
      where: { companyId_normalizedTitle: { companyId, normalizedTitle: targetNormalized } },
      create: {
        companyId,
        externalId: String(bestLiveMatch.externalId),
        title: targetTitle || bestLiveMatch.title,
        normalizedTitle: targetNormalized,
        source: "live_finance_transaction_expense",
        rawData: asRecord(bestLiveMatch.rawData) ?? { title: bestLiveMatch.title },
        isActive: true,
        syncedAt: new Date(),
      },
      update: {
        externalId: String(bestLiveMatch.externalId),
        title: targetTitle || bestLiveMatch.title,
        source: "live_finance_transaction_expense",
        rawData: asRecord(bestLiveMatch.rawData) ?? { title: bestLiveMatch.title },
        isActive: true,
        syncedAt: new Date(),
      },
    });
    return bestLiveMatch.externalId;
  }

  const categories = await fetchExpenseCategories();
  let bestMatch: { category: any; title: string; externalId: number; score: number } | null = null;
  const seenTitles: string[] = [];
  for (const category of categories) {
    const title = cleanText(category.title || category.name || category.category);
    const externalId = toInt(category.id);
    if (!title || !externalId) continue;
    if (seenTitles.length < 12) seenTitles.push(title);
    const score = scorePurposeTitleMatch(targetTitle || "", title);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { category, title, externalId, score };
    }
  }

  if (bestMatch && bestMatch.score >= 80) {
    await (prisma as any).altegioPaymentPurpose.upsert({
      where: { companyId_normalizedTitle: { companyId, normalizedTitle: targetNormalized } },
      create: {
        companyId,
        externalId: String(bestMatch.externalId),
        title: targetTitle || bestMatch.title,
        normalizedTitle: targetNormalized,
        source: "expense",
        rawData: bestMatch.category as object,
        isActive: true,
        syncedAt: new Date(),
      },
      update: {
        externalId: String(bestMatch.externalId),
        title: targetTitle || bestMatch.title,
        source: "expense",
        rawData: bestMatch.category as object,
        isActive: true,
        syncedAt: new Date(),
      },
    });

    if (pending.purposeId) {
      await (prisma as any).bankAltegioPendingPayment.update({
        where: { id: pending.id },
        data: { purposeId: pending.purposeId },
      }).catch(() => null);
    }

    return bestMatch.externalId;
  }

  console.warn("[altegio/finance-create] Не знайдено expense_id для статті", {
    targetTitle,
    targetNormalized,
    bestHistoricalMatch: bestHistoricalMatch
      ? { title: bestHistoricalMatch.title, id: bestHistoricalMatch.externalId, score: bestHistoricalMatch.score }
      : null,
    bestLiveMatch: bestLiveMatch
      ? { title: bestLiveMatch.title, id: bestLiveMatch.externalId, score: bestLiveMatch.score }
      : null,
    bestMatch: bestMatch ? { title: bestMatch.title, id: bestMatch.externalId, score: bestMatch.score } : null,
    liveTitles,
    sampleTitles: seenTitles,
  });
  return null;
}

export async function createAltegioExpenseFromPendingPayment(params: {
  bankStatementItemId: string;
  comment?: string | null;
  createdAt?: Date;
  createdBy?: string | null;
}): Promise<CreateAltegioExpenseFromPendingResult> {
  const companyId = resolveCompanyId();
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: params.bankStatementItemId },
    include: {
      account: {
        select: {
          altegioAccountId: true,
          altegioAccountTitle: true,
        },
      },
    },
  });
  const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    include: { purpose: true },
  });

  if (!statement || !pending) {
    throw new Error("Не знайдено банківський платіж або Telegram-вибір статті");
  }
  if (!statement.account.altegioAccountId) {
    throw new Error("Для банківського рахунку не задано рахунок Altegio");
  }
  const expenseId = await resolveExpenseIdForPendingPurpose(pending, companyId);
  if (!expenseId) {
    throw new Error(
      `Для статті "${pending.purposeTitle}" немає Altegio expense_id. Не знайшли відповідну статтю у локальному кеші, live finance transactions і довіднику Altegio.`,
    );
  }

  const amountKopiykas = absBigint(BigInt(statement.amount));
  const amount = kopiykasToMoney(amountKopiykas);
  const createDate = params.createdAt || new Date();
  const requestedComment = cleanText(params.comment === undefined ? pending.note : params.comment);
  const bankComment = buildBankStatementComment(statement);
  const comment =
    [requestedComment, bankComment].filter((line): line is string => Boolean(line)).join("\n\n") || null;
  const existing = await findExistingLocalTransaction({
    accountId: statement.account.altegioAccountId,
    amountKopiykas,
    operationDate: createDate,
    direction: "out",
    purposeTitle: pending.purposeTitle,
    comment,
  });

  if (existing) {
    await linkBankPaymentToAltegioTransaction({
      bankStatementItemId: params.bankStatementItemId,
      altegioFinanceTransactionId: existing.id,
      reviewNote: `Прив'язано до вже наявного платежу Altegio #${existing.altegioId}`,
    });
    await recalculateAltegioFinanceTransactionBalances({
      companyId,
      accountIds: [statement.account.altegioAccountId],
    }).catch((error) => {
      console.warn("[altegio/finance-create] Не вдалося оновити залишок після прив'язки існуючого платежу", error);
    });
    return { transaction: existing, reusedExisting: true };
  }

  const raw = await createAltegioFinanceTransactionRaw({
    companyId,
    payload: {
      expense_id: expenseId,
      account_id: Number(statement.account.altegioAccountId),
      amount,
      date: altegioKyivDateTime(createDate),
      ...(comment ? { comment } : {}),
    },
  });

  const transaction = await upsertCreatedFinanceTransaction({
    companyId,
    raw,
    fallback: {
      accountId: statement.account.altegioAccountId,
      accountTitle: statement.account.altegioAccountTitle,
      amount,
      date: createDate,
      direction: "out",
      expenseId,
      purposeTitle: pending.purposeTitle,
      comment,
    },
  });

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      note: comment,
      createdBy: params.createdBy ?? pending.createdBy,
    },
  });
  await linkBankPaymentToAltegioTransaction({
    bankStatementItemId: params.bankStatementItemId,
    altegioFinanceTransactionId: transaction.id,
    reviewNote: `Створено платіж Altegio #${transaction.altegioId} з Telegram`,
  });
  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [statement.account.altegioAccountId],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишок після створення платежу", error);
  });

  return { transaction, reusedExisting: false };
}

export async function createAltegioTransferFromPendingPayment(params: {
  bankStatementItemId: string;
  targetAccountId: string;
  targetAccountTitle: string;
  comment: string;
  createdAt?: Date;
  createdBy?: string | null;
}): Promise<CreateAltegioTransferFromPendingResult> {
  const companyId = resolveCompanyId();
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: params.bankStatementItemId },
    include: {
      account: {
        select: {
          altegioAccountId: true,
          altegioAccountTitle: true,
        },
      },
    },
  });
  if (!statement) {
    throw new Error("Банківський платіж не знайдено");
  }
  if (!statement.account.altegioAccountId) {
    throw new Error("Для рахунку-джерела не задано рахунок Altegio");
  }
  if (!params.targetAccountId || params.targetAccountId === statement.account.altegioAccountId) {
    throw new Error("Некоректний рахунок-призначення для переміщення");
  }

  const amountKopiykas = absBigint(BigInt(statement.amount));
  const amount = kopiykasToMoney(amountKopiykas);
  const sourceAccountId = statement.account.altegioAccountId;
  const sourceAccountTitle = statement.account.altegioAccountTitle;
  const createDate = params.createdAt || new Date();
  const requestedComment = cleanText(params.comment);
  const bankComment = buildBankStatementComment(statement);
  const comment =
    [requestedComment, bankComment].filter((line): line is string => Boolean(line)).join("\n\n") || null;
  const existingSource = await findExistingLocalTransaction({
    accountId: sourceAccountId,
    amountKopiykas: -amountKopiykas,
    operationDate: createDate,
    direction: "transfer",
    comment,
  });
  const existingTarget = await findExistingLocalTransaction({
    accountId: params.targetAccountId,
    amountKopiykas,
    operationDate: createDate,
    direction: "transfer",
    comment,
  });

  const sourceTransaction = existingSource ?? await upsertCreatedFinanceTransaction({
    companyId,
    raw: await createAltegioFinanceTransactionRaw({
      companyId,
      payload: {
        account_id: Number(sourceAccountId),
        amount: -amount,
        date: altegioKyivDateTime(createDate),
        comment,
      },
    }),
    fallback: {
      accountId: sourceAccountId,
      accountTitle: sourceAccountTitle,
      amount: -amount,
      date: createDate,
      direction: "transfer",
      purposeTitle: "Переміщення",
      comment,
    },
  });

  const targetTransaction = existingTarget ?? await upsertCreatedFinanceTransaction({
    companyId,
    raw: await createAltegioFinanceTransactionRaw({
      companyId,
      payload: {
        account_id: Number(params.targetAccountId),
        amount,
        date: altegioKyivDateTime(createDate),
        comment,
      },
    }),
    fallback: {
      accountId: params.targetAccountId,
      accountTitle: params.targetAccountTitle,
      amount,
      date: createDate,
      direction: "transfer",
      purposeTitle: "Переміщення",
      comment,
    },
  });

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      status: "linked",
      note: comment,
      createdBy: params.createdBy ?? "telegram",
    },
  }).catch(() => null);
  await linkBankPaymentToAltegioTransaction({
    bankStatementItemId: params.bankStatementItemId,
    altegioFinanceTransactionId: sourceTransaction.id,
    reviewNote: `Створено переміщення Altegio #${sourceTransaction.altegioId} -> #${targetTransaction.altegioId} з Telegram`,
  });
  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [sourceAccountId, params.targetAccountId],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишки після створення переміщення", error);
  });

  return {
    sourceTransaction,
    targetTransaction,
    reusedExisting: Boolean(existingSource && existingTarget),
  };
}
