import { prisma } from "@/lib/prisma";
import { ensureReconciliationNumber } from "@/lib/bank/reconciliation-number";
import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";
import { fetchExpenseCategories } from "./expenses";
import {
  extractPaymentMethodBalanceKopiykas,
  recalculateAltegioFinanceTransactionBalances,
} from "./finance-transaction-balances";
import { normalizePaymentPurposeTitle } from "./finance-transactions-sync";

const CREATE_FINANCE_TRANSACTION_ENDPOINT = "POST /finance_transactions/{locationId}";
const UPDATE_FINANCE_TRANSACTION_ENDPOINT = "PUT /finance_transactions/{locationId}/{transactionId}";
const FINANCE_EXPENSE_LOOKUP_START_DATE = "2026-06-15";

type RawRecord = Record<string, unknown>;

type CreateFinanceTransactionPayload = {
  account_id: number;
  amount: number;
  date: string;
  expense_id?: number;
  comment?: string;
};

/** Статті, які в Altegio створюються лише через документ (товар/склад), не через POST /finance_transactions. */
const DOCUMENT_REQUIRED_PURPOSE_KEYS = new Set([
  "закупівля товарів",
  "закуплено товару",
  "закуплений товар",
  "product purchase",
  "product sales",
  "продаж товарів",
]);

export function isDocumentRequiredPurposeTitle(title: string | null | undefined): boolean {
  const key = normalizePaymentPurposeTitle(title || "");
  if (!key) return false;
  if (DOCUMENT_REQUIRED_PURPOSE_KEYS.has(key)) return true;
  return key.includes("закуп") && key.includes("товар");
}

/**
 * Кнопка Telegram «Переміщення» (між рахунками ФОП/каса).
 *
 * Пара в Altegio:
 * - вихід (−): стаття витрат «Переміщення»
 * - вхід (+): стаття доходів «Переміщення +» (група «Інші доходи»)
 *
 * Завдатки клієнта = лише «Поповнення рахунку» (isDepositTopUpPaymentPurpose).
 */
const TRANSFER_OUT_PURPOSE_TITLES = ["Переміщення"];
const TRANSFER_IN_PURPOSE_TITLES = ["Переміщення +", "Переміщення+", "Переміщення плюс"];
const TRANSFER_OUT_EXPENSE_ID_FALLBACK = 173821;
/** id статті «Переміщення +» з Altegio (references/expenses), після кнопки #6. */
const TRANSFER_IN_EXPENSE_ID_FALLBACK = 188288;

function titleHasPlusMarker(title: string | null | undefined): boolean {
  const key = normalizePaymentPurposeTitle(title || "");
  return key.includes("+") || key.includes("плюс");
}

/** Кнопка Telegram «Переміщення» (не плутати з прибутковою «Переміщення +»). */
export function isTransferPurposeTitle(title: string | null | undefined): boolean {
  const key = normalizePaymentPurposeTitle(title || "");
  if (!key) return false;
  if (titleHasPlusMarker(key)) return false;
  return key.includes("переміщ") || key.includes("перемещ") || key === "transfer";
}

/** Точний пошук expense_id для пари переміщення (не плутати «Переміщення» і «Переміщення +»). */
async function resolveTransferLegExpenseId(
  companyId: string,
  titles: string[],
  kind: "out" | "in",
): Promise<number | null> {
  const normalizedTitles = [
    ...new Set(titles.map((title) => normalizePaymentPurposeTitle(title)).filter(Boolean)),
  ];

  const localRows = await (prisma as any).altegioPaymentPurpose.findMany({
    where: { companyId, externalId: { not: null }, isActive: true },
    select: { externalId: true, title: true, normalizedTitle: true },
    take: 500,
  });

  for (const target of normalizedTitles) {
    for (const row of localRows as Array<{
      externalId: string | null;
      title: string;
      normalizedTitle: string;
    }>) {
      const rowKey = row.normalizedTitle || normalizePaymentPurposeTitle(row.title);
      const hasPlus = titleHasPlusMarker(rowKey) || titleHasPlusMarker(row.title);
      if (kind === "out" && hasPlus) continue;
      if (kind === "in" && !hasPlus) continue;
      if (rowKey === target || normalizePaymentPurposeTitle(row.title) === target) {
        const id = toInt(row.externalId);
        if (id) return id;
      }
    }
  }

  // Нова стаття може ще не бути в локальному кеші — тягнемо довідники Altegio.
  const categories = await fetchExpenseCategories().catch(() => []);
  const incomeCategories =
    kind === "in" ? await fetchIncomePaymentCategories(companyId).catch(() => []) : [];
  const catalog = [...categories, ...incomeCategories];

  for (const target of normalizedTitles) {
    for (const category of catalog) {
      const title = cleanText(
        (category as { title?: string; name?: string; category?: string }).title
          || (category as { name?: string }).name
          || (category as { category?: string }).category,
      );
      if (!title) continue;
      const rowKey = normalizePaymentPurposeTitle(title);
      const hasPlus = titleHasPlusMarker(rowKey);
      if (kind === "out" && hasPlus) continue;
      if (kind === "in" && !hasPlus) continue;
      if (rowKey === target) {
        const id = toInt((category as { id?: unknown }).id);
        if (id) {
          await (prisma as any).altegioPaymentPurpose.upsert({
            where: { companyId_normalizedTitle: { companyId, normalizedTitle: rowKey } },
            create: {
              companyId,
              externalId: String(id),
              title,
              normalizedTitle: rowKey,
              source: "transfer_leg_lookup",
              rawData: category as object,
              isActive: true,
              syncedAt: new Date(),
            },
            update: {
              externalId: String(id),
              title,
              source: "transfer_leg_lookup",
              rawData: category as object,
              isActive: true,
              syncedAt: new Date(),
            },
          }).catch(() => null);
          return id;
        }
      }
    }
  }

  if (kind === "in") {
    const envId = process.env.ALTEGIO_TRANSFER_IN_EXPENSE_ID?.trim();
    if (envId && /^\d+$/.test(envId)) return Number(envId);
    return TRANSFER_IN_EXPENSE_ID_FALLBACK;
  }

  return null;
}

/** Довідник прибуткових статей (для «Переміщення +» у групі «Інші доходи»). */
async function fetchIncomePaymentCategories(
  companyId: string,
): Promise<Array<{ id?: number; title?: string; name?: string; category?: string }>> {
  const attempts = [
    `/company/${companyId}/income_categories`,
    `/income_categories/${companyId}`,
    `/references/incomes/${companyId}`,
    `/company/${companyId}/finances/incomes`,
    `/finances/incomes/${companyId}`,
    `/company/${companyId}/expenses`,
    `/expenses/${companyId}`,
  ];
  const byId = new Map<number, { id: number; title?: string; name?: string; category?: string }>();

  for (const path of attempts) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const root = asRecord(raw);
      const list =
        (Array.isArray(raw) ? raw : null)
        ?? (Array.isArray(root?.data) ? root.data : null)
        ?? (Array.isArray(root?.items) ? root.items : null)
        ?? (Array.isArray(root?.categories) ? root.categories : null)
        ?? [];
      for (const item of list) {
        const rec = asRecord(item);
        if (!rec) continue;
        const id = toInt(rec.id);
        if (!id || byId.has(id)) continue;
        byId.set(id, {
          id,
          title: cleanText(rec.title) ?? undefined,
          name: cleanText(rec.name) ?? undefined,
          category: cleanText(rec.category) ?? undefined,
        });
      }
    } catch {
      // наступний endpoint
    }
  }

  return Array.from(byId.values());
}

function formatAltegioCreateError(error: unknown, purposeTitle: string | null | undefined): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/no document associated with the financial transaction/i.test(raw)) {
    if (isDocumentRequiredPurposeTitle(purposeTitle)) {
      return `${raw}. Стаття «${purposeTitle}» в Altegio потребує документ (закупівля/склад). Створіть платіж вручну в Altegio → Фінанси → Нова транзакція, потім зведіть у таблиці.`;
    }
    return `${raw}. Перевірте expense_id статті «${purposeTitle || "—"}» — оберіть статтю ще раз у Telegram або імпортуйте статті з Altegio.`;
  }
  return raw;
}

type ExpenseIdMatch = {
  title: string;
  externalId: number;
  score: number;
  rawData: unknown;
};

function pickExpenseIdMatchFromFinanceRows(
  targetTitle: string,
  rows: Array<{
    expenseId?: number | null;
    paymentPurpose?: string | null;
    categoryTitle?: string | null;
    rawData?: unknown;
  }>,
): ExpenseIdMatch | null {
  let best: ExpenseIdMatch | null = null;
  for (const row of rows) {
    const raw = asRecord(row.rawData);
    const rawExpense = asRecord(raw?.expense);
    const title = cleanText(
      rawExpense?.title ||
        rawExpense?.name ||
        row.paymentPurpose ||
        row.categoryTitle ||
        raw?.payment_purpose ||
        raw?.paymentPurpose ||
        raw?.purpose,
    );
    const externalId = toInt(row.expenseId ?? raw?.expense_id ?? rawExpense?.id);
    if (!title || !externalId) continue;
    const score = scorePurposeTitleMatch(targetTitle, title);
    if (!best || score > best.score) {
      best = { title, externalId, score, rawData: row.rawData ?? raw };
    }
  }
  return best;
}

function pickExpenseIdMatchFromLiveRows(targetTitle: string, rows: RawRecord[]): ExpenseIdMatch | null {
  let best: ExpenseIdMatch | null = null;
  for (const row of rows) {
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
    const score = scorePurposeTitleMatch(targetTitle, title);
    if (!best || score > best.score) {
      best = { title, externalId, score, rawData: row };
    }
  }
  return best;
}

async function cacheResolvedPaymentPurpose(params: {
  companyId: string;
  targetTitle: string;
  targetNormalized: string;
  match: ExpenseIdMatch;
  source: string;
}): Promise<void> {
  await (prisma as any).altegioPaymentPurpose.upsert({
    where: { companyId_normalizedTitle: { companyId: params.companyId, normalizedTitle: params.targetNormalized } },
    create: {
      companyId: params.companyId,
      externalId: String(params.match.externalId),
      title: params.targetTitle || params.match.title,
      normalizedTitle: params.targetNormalized,
      source: params.source,
      rawData: asRecord(params.match.rawData) ?? { title: params.match.title },
      isActive: true,
      syncedAt: new Date(),
    },
    update: {
      externalId: String(params.match.externalId),
      title: params.targetTitle || params.match.title,
      source: params.source,
      rawData: asRecord(params.match.rawData) ?? { title: params.match.title },
      isActive: true,
      syncedAt: new Date(),
    },
  });
}

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
  purposeTitle?: string | null;
}): Promise<unknown> {
  try {
    return await altegioFetch<unknown>(`/finance_transactions/${params.companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.payload),
    });
  } catch (error) {
    throw new Error(formatAltegioCreateError(error, params.purposeTitle));
  }
}

async function updateAltegioFinanceTransactionRaw(params: {
  companyId: string;
  altegioId: number;
  payload: CreateFinanceTransactionPayload;
}): Promise<unknown> {
  return altegioFetch<unknown>(`/finance_transactions/${params.companyId}/${params.altegioId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.payload),
  });
}

async function deleteAltegioFinanceTransactionRaw(params: {
  companyId: string;
  altegioId: number;
}): Promise<void> {
  await altegioFetch<unknown>(`/finance_transactions/${params.companyId}/${params.altegioId}`, {
    method: "DELETE",
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
  /** Лише точний знак суми (для переміщення: не плутати старий мінус із новим плюсом). */
  strictAmountSign?: boolean;
}): Promise<CreatedAltegioFinanceTransaction | null> {
  const where: any = {
    accountId: params.accountId,
    direction: params.direction,
    deletedInAltegio: false,
    operationDate: { gte: addDays(params.operationDate, -2), lte: addDays(params.operationDate, 2) },
    ...(params.strictAmountSign
      ? { amountKopiykas: params.amountKopiykas }
      : {
          OR: [{ amountKopiykas: params.amountKopiykas }, { amountKopiykas: -params.amountKopiykas }],
        }),
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

  await ensureReconciliationNumber(params.bankStatementItemId);

  return match;
}

async function resolveExpenseIdForPendingPurpose(pending: any, companyId: string): Promise<number | null> {
  const targetTitle = cleanText(pending.purposeTitle);
  const targetNormalized = normalizePaymentPurposeTitle(targetTitle || "");
  if (!targetNormalized) return null;

  if (isDocumentRequiredPurposeTitle(targetTitle)) {
    console.warn("[altegio/finance-create] Стаття потребує документ Altegio, API-створення недоступне", {
      targetTitle,
    });
    return null;
  }

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

  const bestHistoricalMatch = pickExpenseIdMatchFromFinanceRows(targetTitle || "", historicalRows);
  if (bestHistoricalMatch && bestHistoricalMatch.score >= 80) {
    await cacheResolvedPaymentPurpose({
      companyId,
      targetTitle: targetTitle || "",
      targetNormalized,
      match: bestHistoricalMatch,
      source: "finance_transaction_expense",
    });
    return bestHistoricalMatch.externalId;
  }

  const liveRows = await fetchRecentFinanceTransactionRows(companyId);
  const bestLiveMatch = pickExpenseIdMatchFromLiveRows(targetTitle || "", liveRows);
  const liveTitles = liveRows
    .map((row) => cleanText(asRecord(row.expense)?.title ?? asRecord(row.expense)?.name ?? row.payment_purpose))
    .filter((title): title is string => Boolean(title))
    .slice(0, 12);

  if (bestLiveMatch && bestLiveMatch.score >= 80) {
    await cacheResolvedPaymentPurpose({
      companyId,
      targetTitle: targetTitle || "",
      targetNormalized,
      match: bestLiveMatch,
      source: "live_finance_transaction_expense",
    });
    return bestLiveMatch.externalId;
  }

  const catalogId = toInt(pending.purpose?.externalId);
  if (catalogId) {
    console.log("[altegio/finance-create] Використовуємо expense_id з каталогу (fallback)", {
      targetTitle,
      expenseId: catalogId,
    });
    return catalogId;
  }

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
    await cacheResolvedPaymentPurpose({
      companyId,
      targetTitle: targetTitle || "",
      targetNormalized,
      match: {
        title: bestMatch.title,
        externalId: bestMatch.externalId,
        score: bestMatch.score,
        rawData: bestMatch.category,
      },
      source: "expense",
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
    if (isDocumentRequiredPurposeTitle(pending.purposeTitle)) {
      throw new Error(
        `Стаття «${pending.purposeTitle}» в Altegio потребує документ (закупівля/склад). Створіть платіж вручну в Altegio → Фінанси → Нова транзакція, потім зведіть у таблиці.`,
      );
    }
    throw new Error(
      `Для статті "${pending.purposeTitle}" немає Altegio expense_id. Не знайшли відповідну статтю у локальному кеші, live finance transactions і довіднику Altegio.`,
    );
  }

  const amountKopiykas = absBigint(BigInt(statement.amount));
  const amount = kopiykasToMoney(amountKopiykas);
  const createDate = statement.time;
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
    purposeTitle: pending.purposeTitle,
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
  const sourceAccountId = String(statement.account.altegioAccountId);
  const targetAccountId = String(params.targetAccountId);
  if (!targetAccountId || targetAccountId === sourceAccountId) {
    throw new Error("Некоректний рахунок-призначення для переміщення");
  }

  // Вихід (−): «Переміщення». Вхід (+): «Переміщення +» (група «Інші доходи»).
  const outExpenseId =
    (await resolveTransferLegExpenseId(companyId, TRANSFER_OUT_PURPOSE_TITLES, "out"))
    ?? TRANSFER_OUT_EXPENSE_ID_FALLBACK;
  const inExpenseId = await resolveTransferLegExpenseId(companyId, TRANSFER_IN_PURPOSE_TITLES, "in");
  if (!inExpenseId) {
    throw new Error(
      "Не знайдено статтю «Переміщення +» (група «Інші доходи») в Altegio. "
      + "Перевірте точну назву статті або запустіть імпорт статей.",
    );
  }
  const outPurposeTitle = TRANSFER_OUT_PURPOSE_TITLES[0];
  const inPurposeTitle = TRANSFER_IN_PURPOSE_TITLES[0];
  console.log("[altegio/finance-create] Статті міжрахункового переміщення", {
    outExpenseId,
    outPurposeTitle,
    inExpenseId,
    inPurposeTitle,
  });

  const amountKopiykas = absBigint(BigInt(statement.amount));
  const amount = kopiykasToMoney(amountKopiykas);
  const sourceAccountTitle = statement.account.altegioAccountTitle;
  const createDate = statement.time;
  const requestedComment = cleanText(params.comment);
  const bankComment = buildBankStatementComment(statement);
  const comment =
    [requestedComment, bankComment].filter((line): line is string => Boolean(line)).join("\n\n") || null;

  /** Одна нога: sign -1 вихід («Переміщення»), +1 вхід («Переміщення +»). */
  async function createTransferLeg(paramsLeg: {
    accountId: string;
    accountTitle: string | null;
    sign: 1 | -1;
  }): Promise<CreatedAltegioFinanceTransaction> {
    const amountSigned = paramsLeg.sign * amount;
    const amountKopSigned = paramsLeg.sign > 0 ? amountKopiykas : -amountKopiykas;
    const isIncoming = paramsLeg.sign > 0;
    const direction = isIncoming ? "in" : "transfer";
    const expenseId = isIncoming ? inExpenseId : outExpenseId;
    const purposeTitle = isIncoming ? inPurposeTitle : outPurposeTitle;

    const payload: CreateFinanceTransactionPayload = {
      expense_id: expenseId,
      account_id: Number(paramsLeg.accountId),
      amount: amountSigned,
      date: altegioKyivDateTime(createDate),
      ...(comment ? { comment } : {}),
    };

    console.log("[altegio/finance-create] Нога переміщення", {
      leg: isIncoming ? "in (+)" : "out (−)",
      accountId: paramsLeg.accountId,
      accountTitle: paramsLeg.accountTitle,
      amount: amountSigned,
      expenseId,
      purposeTitle,
    });

    const raw = await createAltegioFinanceTransactionRaw({
      companyId,
      purposeTitle,
      payload,
    });

    const createdRow = unwrapCreatedTransaction(raw);
    const createdAmount = toMoneyNumber(createdRow?.amount);
    const createdId = toInt(createdRow?.id);

    if (isIncoming && (createdAmount == null || createdAmount <= 0)) {
      throw new Error(
        `Altegio не прийняло вхідний платіж (+) «${purposeTitle}» на «${paramsLeg.accountTitle || paramsLeg.accountId}»`
          + (createdId ? ` (id=${createdId}, amount=${createdAmount})` : ""),
      );
    }
    if (!isIncoming && (createdAmount == null || createdAmount >= 0)) {
      throw new Error(
        `Altegio не прийняло вихідний платіж (−) «${purposeTitle}» з «${paramsLeg.accountTitle || paramsLeg.accountId}»`
          + (createdId ? ` (id=${createdId}, amount=${createdAmount})` : ""),
      );
    }

    const transaction = await upsertCreatedFinanceTransaction({
      companyId,
      raw,
      fallback: {
        accountId: paramsLeg.accountId,
        accountTitle: paramsLeg.accountTitle,
        amount: amountSigned,
        date: createDate,
        direction,
        expenseId,
        purposeTitle,
        comment,
      },
    });

    if (
      (isIncoming && BigInt(transaction.amountKopiykas) <= 0n)
      || (!isIncoming && BigInt(transaction.amountKopiykas) >= 0n)
    ) {
      await (prisma as any).altegioFinanceTransaction.update({
        where: { id: transaction.id },
        data: {
          amountKopiykas: amountKopSigned,
          direction,
          paymentPurpose: purposeTitle,
          categoryTitle: purposeTitle,
          expenseId,
        },
      });
      return { ...transaction, amountKopiykas: amountKopSigned, direction };
    }

    return transaction;
  }

  async function rollbackLeg(transaction: CreatedAltegioFinanceTransaction | null) {
    if (!transaction?.altegioId) return;
    try {
      await deleteAltegioFinanceTransactionRaw({
        companyId,
        altegioId: Number(transaction.altegioId),
      });
      await (prisma as any).altegioFinanceTransaction.update({
        where: { id: transaction.id },
        data: { deletedInAltegio: true, syncedAt: new Date() },
      }).catch(() => null);
      console.log("[altegio/finance-create] Відкочено ногу переміщення", {
        altegioId: transaction.altegioId,
      });
    } catch (error) {
      console.warn("[altegio/finance-create] Не вдалося відкотити ногу переміщення:", {
        altegioId: transaction.altegioId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 1) Вихідний (−) з рахунку банківського платежу.
  const sourceTransaction = await createTransferLeg({
    accountId: sourceAccountId,
    accountTitle: sourceAccountTitle,
    sign: -1,
  });

  // 2) Вхідний (+) на обраний рахунок.
  let targetTransaction: CreatedAltegioFinanceTransaction;
  try {
    targetTransaction = await createTransferLeg({
      accountId: targetAccountId,
      accountTitle: params.targetAccountTitle,
      sign: 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[altegio/finance-create] Вхідна нога не створена — відкочуємо вихідну", {
      bankStatementItemId: params.bankStatementItemId,
      sourceAltegioId: sourceTransaction.altegioId,
      targetAccountId,
      error: message,
    });
    await rollbackLeg(sourceTransaction);
    throw new Error(
      `Не вдалося створити вхідний (+) на «${params.targetAccountTitle}»: ${message}. `
      + `Вихідний (#${sourceTransaction.altegioId}) відкочено.`,
    );
  }

  if (BigInt(targetTransaction.amountKopiykas) <= 0n) {
    await rollbackLeg(targetTransaction);
    await rollbackLeg(sourceTransaction);
    throw new Error(
      `Вхідний платіж на «${params.targetAccountTitle}» має бути плюсовим. Операції відкочено.`,
    );
  }

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      status: "linked",
      note: comment,
      purposeTitle: "Переміщення",
      createdBy: params.createdBy ?? "telegram",
    },
  }).catch(() => null);
  await linkBankPaymentToAltegioTransaction({
    bankStatementItemId: params.bankStatementItemId,
    altegioFinanceTransactionId: sourceTransaction.id,
    reviewNote:
      `Створено переміщення Altegio #${sourceTransaction.altegioId} (− «${outPurposeTitle}») `
      + `→ #${targetTransaction.altegioId} (+ «${inPurposeTitle}»)`,
  });
  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [sourceAccountId, targetAccountId],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишки після переміщення", error);
  });

  console.log("[altegio/finance-create] Переміщення створено", {
    bankStatementItemId: params.bankStatementItemId,
    outExpenseId,
    outPurposeTitle,
    inExpenseId,
    inPurposeTitle,
    sourceAltegioId: sourceTransaction.altegioId,
    sourceAmount: sourceTransaction.amountKopiykas.toString(),
    targetAltegioId: targetTransaction.altegioId,
    targetAmount: targetTransaction.amountKopiykas.toString(),
    sourceAccountId,
    targetAccountId,
  });

  return {
    sourceTransaction,
    targetTransaction,
    reusedExisting: false,
  };
}

export type UpdateAltegioLinkedExpenseFromPendingResult = {
  transaction: CreatedAltegioFinanceTransaction;
  purposeChanged: boolean;
  commentChanged: boolean;
};

/** Оновлює статтю та/або коментар у вже зведеній операції Altegio (без відв'язування match). */
export async function updateAltegioLinkedExpenseFromPendingPayment(params: {
  bankStatementItemId: string;
  comment?: string | null;
  preserveComment?: boolean;
  updatedBy?: string | null;
}): Promise<UpdateAltegioLinkedExpenseFromPendingResult> {
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
  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    select: {
      status: true,
      altegioFinanceTransactionId: true,
      reviewNote: true,
    },
  });
  const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    include: { purpose: true },
  });

  if (!statement) {
    throw new Error("Банківський платіж не знайдено");
  }
  if (
    !match?.altegioFinanceTransactionId ||
    !["auto_matched", "manual_matched"].includes(String(match.status || ""))
  ) {
    throw new Error("Платіж не зведено — оновлення через Telegram недоступне");
  }
  if (!pending?.purposeTitle) {
    throw new Error("Не обрано статтю витрат для оновлення");
  }

  const linked = await (prisma as any).altegioFinanceTransaction.findUnique({
    where: { id: match.altegioFinanceTransactionId },
  });
  if (!linked) {
    throw new Error("Зв'язану операцію Altegio не знайдено в локальній базі");
  }

  const expenseId = await resolveExpenseIdForPendingPurpose(pending, companyId);
  if (!expenseId) {
    throw new Error(
      `Для статті "${pending.purposeTitle}" немає Altegio expense_id. Не знайшли відповідну статтю у локальному кеші.`,
    );
  }

  const accountId = toInt(linked.accountId ?? statement.account.altegioAccountId);
  if (!accountId) {
    throw new Error("Для операції Altegio не задано рахунок");
  }

  const amountKopiykas = absBigint(BigInt(linked.amountKopiykas));
  const amount = kopiykasToMoney(amountKopiykas);
  const operationDate = linked.operationDate instanceof Date ? linked.operationDate : new Date(linked.operationDate);
  const previousPurpose =
    cleanText(linked.paymentPurpose) || cleanText(linked.categoryTitle) || cleanText(pending.purposeTitle);
  const previousComment = cleanText(linked.comment);

  let nextComment: string | null;
  let commentChanged: boolean;
  if (params.preserveComment) {
    nextComment = previousComment;
    commentChanged = false;
  } else {
    const requestedComment = cleanText(params.comment === undefined ? pending.note : params.comment);
    const bankComment = buildBankStatementComment(statement);
    nextComment =
      [requestedComment, bankComment].filter((line): line is string => Boolean(line)).join("\n\n") || null;
    commentChanged = nextComment !== previousComment;
  }

  const purposeChanged = normalizePaymentPurposeTitle(pending.purposeTitle) !== normalizePaymentPurposeTitle(previousPurpose || "");

  const raw = await updateAltegioFinanceTransactionRaw({
    companyId,
    altegioId: Number(linked.altegioId),
    payload: {
      expense_id: expenseId,
      account_id: accountId,
      amount,
      date: altegioKyivDateTime(operationDate),
      ...(nextComment != null ? { comment: nextComment } : {}),
    },
  });

  const transaction = await upsertCreatedFinanceTransaction({
    companyId,
    raw,
    fallback: {
      accountId: String(accountId),
      accountTitle: linked.accountTitle ?? statement.account.altegioAccountTitle,
      amount,
      date: operationDate,
      direction: linked.direction || "out",
      expenseId,
      purposeTitle: pending.purposeTitle,
      comment: nextComment,
    },
  });

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      status: "linked",
      note: params.preserveComment ? pending.note : nextComment,
      createdBy: params.updatedBy ?? pending.createdBy,
    },
  }).catch(() => null);

  await (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      reviewNote: `Оновлено в Altegio через Telegram: ${pending.purposeTitle}${
        commentChanged ? " (коментар змінено)" : ""
      }`,
    },
  });

  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [String(accountId)],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишок після редагування платежу", error);
  });

  console.log("[altegio/finance-create] Оновлено зведену операцію Altegio", {
    bankStatementItemId: params.bankStatementItemId,
    altegioId: linked.altegioId,
    purposeTitle: pending.purposeTitle,
    purposeChanged,
    commentChanged,
    sourceEndpoint: UPDATE_FINANCE_TRANSACTION_ENDPOINT,
  });

  return { transaction, purposeChanged, commentChanged };
}

const INCOMING_ACQUIRING_EXPENSE_TITLES = ["Комісія за еквайринг", "Еквайрінг"];
const TERMINAL_FEE_EXPENSE_TITLES = ["ТЕРМІНАЛ", "Термінал", "термінал"];

async function upsertLocalPaymentPurpose(params: {
  companyId: string;
  externalId: number;
  title: string;
  normalizedTitle: string;
  source: string;
  rawData?: object | null;
}) {
  await (prisma as any).altegioPaymentPurpose.upsert({
    where: {
      companyId_normalizedTitle: {
        companyId: params.companyId,
        normalizedTitle: params.normalizedTitle,
      },
    },
    create: {
      companyId: params.companyId,
      externalId: String(params.externalId),
      title: params.title,
      normalizedTitle: params.normalizedTitle,
      source: params.source,
      rawData: params.rawData ?? { title: params.title },
      isActive: true,
      syncedAt: new Date(),
    },
    update: {
      externalId: String(params.externalId),
      title: params.title,
      source: params.source,
      rawData: params.rawData ?? { title: params.title },
      isActive: true,
      syncedAt: new Date(),
    },
  });
}

async function resolveExpenseIdFromLiveCategories(
  companyId: string,
  titles: string[],
): Promise<{ expenseId: number; title: string } | null> {
  const targetNormalized = new Set(
    titles.map((title) => normalizePaymentPurposeTitle(title)).filter(Boolean),
  );
  if (targetNormalized.size === 0) return null;

  const categories = await fetchExpenseCategories();
  for (const category of categories) {
    const title = cleanText(category.title || category.name || category.category);
    const externalId = toInt(category.id);
    if (!title || !externalId) continue;
    const normalized = normalizePaymentPurposeTitle(title);
    if (!targetNormalized.has(normalized)) continue;

    await upsertLocalPaymentPurpose({
      companyId,
      externalId,
      title,
      normalizedTitle: normalized,
      source: "expense_categories_live",
      rawData: category as object,
    });

    console.log("[altegio/finance-create] Знайдено статтю витрат у live-каталозі Altegio", {
      title,
      externalId,
      normalized,
    });

    return { expenseId: externalId, title };
  }

  return null;
}

async function resolveExpenseIdByTitles(companyId: string, titles: string[]): Promise<number | null> {
  const normalizedTitles = [...new Set(titles.map((title) => normalizePaymentPurposeTitle(title)).filter(Boolean))];

  if (normalizedTitles.length > 0) {
    const localPurpose = await (prisma as any).altegioPaymentPurpose.findFirst({
      where: {
        companyId,
        normalizedTitle: { in: normalizedTitles },
        externalId: { not: null },
      },
      select: { externalId: true },
    });
    const localId = toInt(localPurpose?.externalId);
    if (localId) return localId;
  }

  for (const title of titles) {
    const targetNormalized = normalizePaymentPurposeTitle(title);
    const localPurpose = await (prisma as any).altegioPaymentPurpose.findFirst({
      where: {
        companyId,
        OR: [{ normalizedTitle: targetNormalized }, { title: { equals: title, mode: "insensitive" } }],
        externalId: { not: null },
      },
      select: { externalId: true },
    });
    const localId = toInt(localPurpose?.externalId);
    if (localId) return localId;
  }

  for (const title of titles) {
    const expenseId = await resolveExpenseIdForPendingPurpose(
      { purposeTitle: title, purpose: null },
      companyId,
    );
    if (expenseId) return expenseId;
  }

  const liveMatch = await resolveExpenseIdFromLiveCategories(companyId, titles);
  if (liveMatch) return liveMatch.expenseId;

  const terminalEnvId = process.env.ALTEGIO_TERMINAL_EXPENSE_ID?.trim();
  if (
    terminalEnvId &&
    /^\d+$/.test(terminalEnvId) &&
    titles.some((title) => normalizePaymentPurposeTitle(title).includes("термінал"))
  ) {
    return Number(terminalEnvId);
  }

  return null;
}

export type CreateIncomingAcquiringExpenseResult = {
  transaction: CreatedAltegioFinanceTransaction;
  reusedExisting: boolean;
};

/** Вихідний платіж «Еквайрінг» для вхідного зведення — без Telegram. */
export async function createIncomingAcquiringExpense(params: {
  bankStatementItemId: string;
  commissionKopiykas: bigint;
  comment: string;
  expenseDate: Date;
  matchedBy?: string | null;
}): Promise<CreateIncomingAcquiringExpenseResult> {
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
    throw new Error("Не знайдено банківський платіж для еквайрингу");
  }
  if (!statement.account.altegioAccountId) {
    throw new Error("Для банківського рахунку не задано рахунок Altegio");
  }
  if (params.commissionKopiykas <= 0n) {
    throw new Error("Сума комісії еквайрингу має бути більше нуля");
  }

  const expenseId = await resolveExpenseIdByTitles(companyId, INCOMING_ACQUIRING_EXPENSE_TITLES);
  if (!expenseId) {
    throw new Error(
      `Не знайдено статтю витрат «${INCOMING_ACQUIRING_EXPENSE_TITLES.join("» / «")}» в Altegio`,
    );
  }

  const amountKopiykas = absBigint(params.commissionKopiykas);
  const amount = kopiykasToMoney(amountKopiykas);
  const createDate = params.expenseDate;
  const comment = cleanText(params.comment);
  const purposeTitle = INCOMING_ACQUIRING_EXPENSE_TITLES[0];

  const existing = await findExistingLocalTransaction({
    accountId: statement.account.altegioAccountId,
    amountKopiykas,
    operationDate: createDate,
    direction: "out",
    purposeTitle,
    comment,
  });

  if (existing) {
    console.log("[altegio/finance-create] Повторне використання існуючого еквайрингу", {
      bankStatementItemId: params.bankStatementItemId,
      altegioId: existing.altegioId,
    });
    await recalculateAltegioFinanceTransactionBalances({
      companyId,
      accountIds: [statement.account.altegioAccountId],
    }).catch((error) => {
      console.warn("[altegio/finance-create] Не вдалося оновити залишок після еквайрингу", error);
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
      purposeTitle,
      comment,
    },
  });

  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [statement.account.altegioAccountId],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишок після створення еквайрингу", error);
  });

  console.log("[altegio/finance-create] Створено вихідний платіж еквайрингу (вхідне зведення)", {
    bankStatementItemId: params.bankStatementItemId,
    altegioId: transaction.altegioId,
    commissionKop: amountKopiykas.toString(),
    matchedBy: params.matchedBy ?? null,
    comment,
  });

  return { transaction, reusedExisting: false };
}

export type CreateAutomaticTerminalExpenseResult = {
  transaction: CreatedAltegioFinanceTransaction;
  reusedExisting: boolean;
};

/** Вихідний платіж «Термінал» — комісія за РКО від Universal Bank. */
export async function createAutomaticTerminalExpense(params: {
  bankStatementItemId: string;
  amountKopiykas: bigint;
  comment: string;
  expenseDate: Date;
  matchedBy?: string | null;
}): Promise<CreateAutomaticTerminalExpenseResult> {
  const companyId = resolveCompanyId();
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: params.bankStatementItemId },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
        },
      },
    },
  });

  if (!statement) {
    throw new Error("Не знайдено банківський платіж для терміналу");
  }
  if (!statement.account.altegioAccountId) {
    throw new Error("Для банківського рахунку не задано рахунок Altegio");
  }
  if (params.amountKopiykas <= 0n) {
    throw new Error("Сума оплати за термінал має бути більше нуля");
  }

  const expenseId = await resolveExpenseIdByTitles(companyId, TERMINAL_FEE_EXPENSE_TITLES);
  if (!expenseId) {
    throw new Error(
      `Не знайдено статтю витрат «${TERMINAL_FEE_EXPENSE_TITLES.join("» / «")}» в Altegio. Перевірте назву в Altegio або запустіть синхронізацію статей.`,
    );
  }

  const amountKopiykas = absBigint(params.amountKopiykas);
  const amount = kopiykasToMoney(amountKopiykas);
  const createDate = params.expenseDate;
  const comment = cleanText(params.comment);
  const localPurpose = await (prisma as any).altegioPaymentPurpose.findFirst({
    where: { companyId, externalId: String(expenseId) },
    select: { title: true },
  });
  const purposeTitle = cleanText(localPurpose?.title) || TERMINAL_FEE_EXPENSE_TITLES[0];

  const existing = await findExistingLocalTransaction({
    accountId: statement.account.altegioAccountId,
    amountKopiykas,
    operationDate: createDate,
    direction: "out",
    purposeTitle,
    comment,
  });

  if (existing) {
    console.log("[altegio/finance-create] Повторне використання існуючого терміналу", {
      bankStatementItemId: params.bankStatementItemId,
      altegioId: existing.altegioId,
    });
    await recalculateAltegioFinanceTransactionBalances({
      companyId,
      accountIds: [statement.account.altegioAccountId],
    }).catch((error) => {
      console.warn("[altegio/finance-create] Не вдалося оновити залишок після терміналу", error);
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
      purposeTitle,
      comment,
    },
  });

  await recalculateAltegioFinanceTransactionBalances({
    companyId,
    accountIds: [statement.account.altegioAccountId],
  }).catch((error) => {
    console.warn("[altegio/finance-create] Не вдалося оновити залишок після створення терміналу", error);
  });

  console.log("[altegio/finance-create] Створено вихідний платіж за термінал (РКО)", {
    bankStatementItemId: params.bankStatementItemId,
    altegioId: transaction.altegioId,
    amountKop: amountKopiykas.toString(),
    matchedBy: params.matchedBy ?? null,
    comment,
  });

  return { transaction, reusedExisting: false };
}
