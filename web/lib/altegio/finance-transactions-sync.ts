import { prisma } from "@/lib/prisma";
import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";
import { fetchExpenseCategories, type AltegioExpenseCategory } from "./expenses";
import {
  extractPaymentMethodBalanceKopiykas,
  recalculateAltegioFinanceTransactionBalances,
} from "./finance-transaction-balances";

export const ALTEGIO_FINANCE_SYNC_START_DATE = "2026-06-15";
const FINANCE_SYNC_KEY = "altegio-finance-transactions";
const SOURCE_ENDPOINT = "POST /company/{companyId}/finance_transactions/search";

type RawAltegioFinanceTransaction = {
  id?: number | string;
  document_id?: number | string;
  documentId?: number | string;
  document?: {
    id?: number | string;
    document_id?: number | string;
  };
  expense_id?: number | string;
  expense?: {
    id?: number | string;
    name?: string;
    title?: string;
    category?: string;
  };
  account_id?: number | string;
  account?: {
    id?: number | string;
    name?: string;
    title?: string;
  };
  amount?: number | string;
  date?: string;
  created_at?: string;
  type?: string;
  type_id?: number | string;
  comment?: string;
  payment_purpose?: string;
  paymentPurpose?: string;
  purpose?: string;
  supplier?: { name?: string; title?: string };
  supplier_name?: string;
  counterparty?: { name?: string; title?: string };
  counterparty_name?: string;
  real_money?: boolean | number | string;
  deleted?: boolean | number | string;
  [key: string]: unknown;
};

type FinanceTransactionsPageResult = {
  rows: RawAltegioFinanceTransaction[];
  sourceEndpoint: string;
};

export type SyncAltegioFinanceTransactionsResult = {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  fetched: number;
  upserted: number;
  skippedUnchanged?: number;
  purposesSynced: number;
  sourceEndpoint: string;
};

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID is required to sync finance transactions");
  }
  return companyId;
}

function normalizeDateInput(value: string | undefined, fallback: string): string {
  const candidate = (value || fallback).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function unwrapArray(raw: unknown): RawAltegioFinanceTransaction[] {
  if (Array.isArray(raw)) return raw as RawAltegioFinanceTransaction[];
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as Record<string, unknown>;
  if (Array.isArray(payload.data)) return payload.data as RawAltegioFinanceTransaction[];
  if (Array.isArray(payload.transactions)) return payload.transactions as RawAltegioFinanceTransaction[];
  if (Array.isArray(payload.items)) return payload.items as RawAltegioFinanceTransaction[];
  if (payload.data && typeof payload.data === "object") {
    const nested = payload.data as Record<string, unknown>;
    if (Array.isArray(nested.data)) return nested.data as RawAltegioFinanceTransaction[];
    if (Array.isArray(nested.items)) return nested.items as RawAltegioFinanceTransaction[];
  }
  return [];
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

function toKopiykas(value: unknown): bigint {
  return BigInt(Math.round(toMoneyNumber(value) * 100));
}

function truthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function cleanText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

export function normalizePaymentPurposeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Зберігаємо «+» як окремий маркер (інакше «Переміщення» і «Переміщення +» зливаються).
    .replace(/\+/g, " plus ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function kyivDayFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseAltegioDate(value: unknown): Date {
  const text = cleanText(value);
  if (!text) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T00:00:00.000+03:00`);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getCategoryTitle(raw: RawAltegioFinanceTransaction): string | null {
  return cleanText(raw.expense?.title || raw.expense?.name || raw.expense?.category);
}

import { resolveAltegioPaymentPurposeFromRaw } from "./payment-purpose-import";

function getPaymentPurpose(raw: RawAltegioFinanceTransaction): string | null {
  const fromExpense = resolveAltegioPaymentPurposeFromRaw(raw as Record<string, unknown>);
  if (fromExpense) return fromExpense;

  return cleanText(
    raw.payment_purpose ||
      raw.paymentPurpose ||
      raw.purpose ||
      raw.comment ||
      raw.expense?.title ||
      raw.expense?.name,
  );
}

function getCounterpartyName(raw: RawAltegioFinanceTransaction): string | null {
  return cleanText(
    raw.counterparty_name ||
      raw.counterparty?.title ||
      raw.counterparty?.name ||
      raw.supplier_name ||
      raw.supplier?.title ||
      raw.supplier?.name,
  );
}

function getDocumentId(raw: RawAltegioFinanceTransaction): number | null {
  return toInt(raw.document_id ?? raw.documentId ?? raw.document?.id ?? raw.document?.document_id);
}

function detectDirection(raw: RawAltegioFinanceTransaction, amountKopiykas: bigint): string {
  const type = String(raw.type || "").toLowerCase();
  const typeId = String(raw.type_id || "").toLowerCase();
  const expenseId = toInt(raw.expense_id ?? raw.expense?.id);
  const documentId = toInt(raw.document_id ?? raw.documentId ?? raw.document?.id ?? raw.document?.document_id);
  if (type.includes("transfer") || type.includes("переміщ") || type.includes("перевод")) return "transfer";
  if (expenseId || type.includes("expense") || typeId === "2") return "out";
  if (type.includes("income") || typeId === "1") return "in";
  if (documentId) return "in";
  if (amountKopiykas < 0n) return "out";
  if (amountKopiykas > 0n) return "in";
  return "unknown";
}

async function fetchFinanceTransactionsPage(params: {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  count: number;
}): Promise<FinanceTransactionsPageResult> {
  const attempts: Array<{
    sourceEndpoint: string;
    path: string;
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    params?: URLSearchParams;
  }> = [
    {
      sourceEndpoint: SOURCE_ENDPOINT,
      method: "POST",
      path: `/company/${params.companyId}/finance_transactions/search`,
      body: {
        start_date: params.dateFrom,
        end_date: params.dateTo,
        deleted: false,
        count: params.count,
        page: params.page,
      },
    },
    {
      sourceEndpoint: "GET /transactions/{companyId}",
      method: "GET",
      path: `/transactions/${params.companyId}`,
      params: new URLSearchParams({
        start_date: params.dateFrom,
        end_date: params.dateTo,
        deleted: "0",
        count: String(params.count),
        page: String(params.page),
      }),
    },
    {
      sourceEndpoint: "GET /finance_transactions/{companyId}",
      method: "GET",
      path: `/finance_transactions/${params.companyId}`,
      params: new URLSearchParams({
        start_date: params.dateFrom,
        end_date: params.dateTo,
        deleted: "0",
        count: String(params.count),
        page: String(params.page),
      }),
    },
    {
      sourceEndpoint: "GET /transactions/{companyId} date_from/date_to",
      method: "GET",
      path: `/transactions/${params.companyId}`,
      params: new URLSearchParams({
        date_from: params.dateFrom,
        date_to: params.dateTo,
        deleted: "0",
        count: String(params.count),
        page: String(params.page),
      }),
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const path = attempt.params ? `${attempt.path}?${attempt.params.toString()}` : attempt.path;
      const raw = await altegioFetch<unknown>(
        attempt.method === "POST" ? attempt.path : path,
        attempt.method === "POST"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attempt.body || {}),
            }
          : {},
      );
      const rows = unwrapArray(raw);
      console.log("[altegio/finance-sync] Джерело фінансових операцій", {
        sourceEndpoint: attempt.sourceEndpoint,
        page: params.page,
        rows: rows.length,
      });
      return { rows, sourceEndpoint: attempt.sourceEndpoint };
    } catch (error) {
      lastError = error;
      console.warn("[altegio/finance-sync] Endpoint не спрацював, пробуємо наступний", {
        sourceEndpoint: attempt.sourceEndpoint,
        page: params.page,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Не вдалося отримати фінансові операції Altegio"));
}

async function syncPaymentPurposes(companyId: string): Promise<number> {
  let categories: AltegioExpenseCategory[] = [];
  try {
    categories = await fetchExpenseCategories();
  } catch (error) {
    console.warn("[altegio/finance-sync] Не вдалося синхронізувати довідник призначень:", error);
    return 0;
  }

  let synced = 0;
  for (const category of categories) {
    const title = cleanText(category.title || category.name || category.category);
    if (!title) continue;
    const normalizedTitle = normalizePaymentPurposeTitle(title);
    if (!normalizedTitle) continue;

    await (prisma as any).altegioPaymentPurpose.upsert({
      where: {
        companyId_normalizedTitle: { companyId, normalizedTitle },
      },
      create: {
        companyId,
        externalId: category.id != null ? String(category.id) : null,
        title,
        normalizedTitle,
        source: "expense",
        rawData: category as object,
        isActive: true,
        syncedAt: new Date(),
      },
      update: {
        externalId: category.id != null ? String(category.id) : null,
        title,
        source: "expense",
        rawData: category as object,
        isActive: true,
        syncedAt: new Date(),
      },
    });
    synced += 1;
  }
  return synced;
}

export async function syncAltegioFinanceTransactions(params: {
  dateFrom?: string;
  dateTo?: string;
  companyId?: string;
  maxPages?: number;
  syncPurposes?: boolean;
} = {}): Promise<SyncAltegioFinanceTransactionsResult> {
  const companyId = params.companyId || resolveCompanyId();
  const dateFrom = normalizeDateInput(params.dateFrom, ALTEGIO_FINANCE_SYNC_START_DATE);
  const dateTo = normalizeDateInput(params.dateTo, new Date().toISOString().slice(0, 10));
  const maxPages = Math.max(1, Math.min(params.maxPages ?? 50, 100));
  const count = 1000;
  const startedAt = new Date();

  await (prisma as any).altegioFinanceSyncState.upsert({
    where: { companyId_syncKey: { companyId, syncKey: FINANCE_SYNC_KEY } },
    create: {
      companyId,
      syncKey: FINANCE_SYNC_KEY,
      status: "running",
      startedAt,
      lastSyncedFrom: new Date(`${dateFrom}T00:00:00.000Z`),
      lastSyncedTo: new Date(`${dateTo}T23:59:59.999Z`),
    },
    update: {
      status: "running",
      startedAt,
      lastError: null,
      lastSyncedFrom: new Date(`${dateFrom}T00:00:00.000Z`),
      lastSyncedTo: new Date(`${dateTo}T23:59:59.999Z`),
    },
  });

  let fetched = 0;
  let upserted = 0;
  let skippedUnchanged = 0;
  let lastPage = 0;
  let sourceEndpoint = SOURCE_ENDPOINT;
  /** Призначення: один upsert на унікальний normalizedTitle за весь запуск */
  const purposesFromRows = new Map<
    string,
    { title: string; expenseId: number | null; raw: RawAltegioFinanceTransaction }
  >();

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      lastPage = page;
      const pageResult = await fetchFinanceTransactionsPage({ companyId, dateFrom, dateTo, page, count });
      const rows = pageResult.rows;
      sourceEndpoint = pageResult.sourceEndpoint;
      fetched += rows.length;

      const parsed = rows
        .map((row) => {
          const altegioId = toInt(row.id);
          if (!altegioId) return null;
          const operationDate = parseAltegioDate(row.date || row.created_at);
          const amountKopiykas = toKopiykas(row.amount);
          const direction = detectDirection(row, amountKopiykas);
          const accountId = toInt(row.account_id ?? row.account?.id);
          const expenseId = toInt(row.expense_id ?? row.expense?.id);
          const categoryTitle = getCategoryTitle(row);
          const paymentPurpose = getPaymentPurpose(row);
          const accountBalanceAfterKopiykas = extractPaymentMethodBalanceKopiykas(
            row,
            accountId != null ? String(accountId) : null,
          );
          return {
            row,
            altegioId,
            operationDate,
            amountKopiykas,
            direction,
            accountId,
            expenseId,
            categoryTitle,
            paymentPurpose,
            accountBalanceAfterKopiykas,
            accountTitle: cleanText(row.account?.title || row.account?.name),
            documentId: getDocumentId(row),
            comment: cleanText(row.comment),
            counterpartyName: getCounterpartyName(row),
            deletedInAltegio: truthyFlag(row.deleted),
            kyivDay: kyivDayFromDate(operationDate),
          };
        })
        .filter(Boolean) as Array<{
        row: RawAltegioFinanceTransaction;
        altegioId: number;
        operationDate: Date;
        amountKopiykas: bigint;
        direction: string;
        accountId: number | null;
        expenseId: number | null;
        categoryTitle: string | null;
        paymentPurpose: string | null;
        accountBalanceAfterKopiykas: bigint | null;
        accountTitle: string | null;
        documentId: number | null;
        comment: string | null;
        counterpartyName: string | null;
        deletedInAltegio: boolean;
        kyivDay: string;
      }>;

      const pageIds = parsed.map((p) => p.altegioId);
      const existingRows =
        pageIds.length > 0
          ? await (prisma as any).altegioFinanceTransaction.findMany({
              where: { companyId, altegioId: { in: pageIds } },
              select: {
                altegioId: true,
                accountId: true,
                accountTitle: true,
                documentId: true,
                expenseId: true,
                operationDate: true,
                kyivDay: true,
                amountKopiykas: true,
                accountBalanceAfterKopiykas: true,
                direction: true,
                categoryTitle: true,
                paymentPurpose: true,
                comment: true,
                counterpartyName: true,
                deletedInAltegio: true,
              },
            })
          : [];
      const existingById = new Map<number, (typeof existingRows)[number]>(
        existingRows.map((r: { altegioId: number }) => [r.altegioId, r]),
      );

      for (const item of parsed) {
        if (item.paymentPurpose) {
          const normalizedTitle = normalizePaymentPurposeTitle(item.paymentPurpose);
          if (normalizedTitle && !purposesFromRows.has(normalizedTitle)) {
            purposesFromRows.set(normalizedTitle, {
              title: item.paymentPurpose,
              expenseId: item.expenseId,
              raw: item.row,
            });
          }
        }

        const existing = existingById.get(item.altegioId);
        const same =
          existing &&
          String(existing.accountId ?? "") === String(item.accountId != null ? String(item.accountId) : "") &&
          String(existing.accountTitle ?? "") === String(item.accountTitle ?? "") &&
          String(existing.documentId ?? "") === String(item.documentId ?? "") &&
          Number(existing.expenseId ?? 0) === Number(item.expenseId ?? 0) &&
          new Date(existing.operationDate).getTime() === item.operationDate.getTime() &&
          String(existing.kyivDay ?? "") === String(item.kyivDay ?? "") &&
          BigInt(existing.amountKopiykas) === item.amountKopiykas &&
          BigInt(existing.accountBalanceAfterKopiykas ?? 0) ===
            BigInt(item.accountBalanceAfterKopiykas ?? 0) &&
          String(existing.direction ?? "") === String(item.direction ?? "") &&
          String(existing.categoryTitle ?? "") === String(item.categoryTitle ?? "") &&
          String(existing.paymentPurpose ?? "") === String(item.paymentPurpose ?? "") &&
          String(existing.comment ?? "") === String(item.comment ?? "") &&
          String(existing.counterpartyName ?? "") === String(item.counterpartyName ?? "") &&
          Boolean(existing.deletedInAltegio) === Boolean(item.deletedInAltegio);

        if (same) {
          skippedUnchanged += 1;
          continue;
        }

        const data = {
          accountId: item.accountId != null ? String(item.accountId) : null,
          accountTitle: item.accountTitle,
          documentId: item.documentId,
          expenseId: item.expenseId,
          operationDate: item.operationDate,
          kyivDay: item.kyivDay,
          amountKopiykas: item.amountKopiykas,
          accountBalanceAfterKopiykas: item.accountBalanceAfterKopiykas,
          direction: item.direction,
          categoryTitle: item.categoryTitle,
          paymentPurpose: item.paymentPurpose,
          comment: item.comment,
          counterpartyName: item.counterpartyName,
          sourceEndpoint,
          rawData: item.row as object,
          deletedInAltegio: item.deletedInAltegio,
          syncedAt: new Date(),
        };

        await (prisma as any).altegioFinanceTransaction.upsert({
          where: { companyId_altegioId: { companyId, altegioId: item.altegioId } },
          create: {
            altegioId: item.altegioId,
            companyId,
            ...data,
          },
          update: data,
        });
        upserted += 1;
      }

      if (rows.length < count) break;
    }

    // Призначення з транзакцій — один раз на унікальний title
    for (const [normalizedTitle, purpose] of purposesFromRows.entries()) {
      await (prisma as any).altegioPaymentPurpose.upsert({
        where: { companyId_normalizedTitle: { companyId, normalizedTitle } },
        create: {
          companyId,
          externalId: purpose.expenseId != null ? String(purpose.expenseId) : null,
          title: purpose.title,
          normalizedTitle,
          source: "finance_transaction",
          rawData: purpose.raw as object,
          isActive: true,
          syncedAt: new Date(),
        },
        update: {
          title: purpose.title,
          externalId: purpose.expenseId != null ? String(purpose.expenseId) : null,
          isActive: true,
          syncedAt: new Date(),
        },
      });
    }

    const purposesSynced = params.syncPurposes === false ? 0 : await syncPaymentPurposes(companyId);
    const balances = await recalculateAltegioFinanceTransactionBalances({ companyId });
    await (prisma as any).altegioFinanceSyncState.update({
      where: { companyId_syncKey: { companyId, syncKey: FINANCE_SYNC_KEY } },
      data: {
        status: "success",
        lastPage,
        syncedCount: upserted,
        finishedAt: new Date(),
      },
    });

    console.log("[altegio/finance-sync] Синхронізація фінансових операцій завершена", {
      companyId,
      dateFrom,
      dateTo,
      fetched,
      upserted,
      skippedUnchanged,
      purposesFromRows: purposesFromRows.size,
      purposesSynced,
      balancesUpdated: balances.transactionsUpdated,
    });

    return {
      companyId,
      dateFrom,
      dateTo,
      fetched,
      upserted,
      skippedUnchanged,
      purposesSynced,
      sourceEndpoint,
    };
  } catch (error) {
    await (prisma as any).altegioFinanceSyncState.update({
      where: { companyId_syncKey: { companyId, syncKey: FINANCE_SYNC_KEY } },
      data: {
        status: "failed",
        lastPage,
        syncedCount: upserted,
        lastError: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
