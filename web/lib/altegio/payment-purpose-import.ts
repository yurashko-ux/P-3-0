import { prisma } from "@/lib/prisma";
import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";
import { fetchExpenseCategories, type AltegioExpenseCategory } from "./expenses";
import { ALTEGIO_FINANCE_SYNC_START_DATE, normalizePaymentPurposeTitle } from "./finance-transactions-sync";

type RawRecord = Record<string, unknown>;

export type ImportedAltegioPaymentPurpose = {
  externalId: string;
  title: string;
  normalizedTitle: string;
  occurrences: number;
  sourceEndpoints: string[];
  sampleTransactionIds: number[];
};

export type ImportAltegioPaymentPurposesResult = {
  ok: true;
  companyId: string;
  dateFrom: string;
  dateTo: string;
  dryRun: boolean;
  fetchedTransactions: number;
  catalogCount: number;
  transactionOnlyCount: number;
  hasTerminal: boolean;
  foundPurposes: number;
  upserted: number;
  purposes: ImportedAltegioPaymentPurpose[];
  warnings: string[];
};

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для імпорту статей Altegio");
  }
  return companyId;
}

function normalizeDateInput(value: string | undefined, fallback: string): string {
  const candidate = (value || fallback).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
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

function containsUkrainianText(value: string): boolean {
  return /[А-ЩЬЮЯЄІЇҐа-щьюяєіїґ]/.test(value);
}

function pickCategoryTitle(...values: unknown[]): string | null {
  const titles = values.map((value) => cleanText(value)).filter((value): value is string => value != null);
  return titles.find(containsUkrainianText) || titles[0] || null;
}

const UKRAINIAN_PURPOSE_TITLES_BY_EXTERNAL_ID: Record<string, string> = {
  "1": "Закупівля матеріалів",
  "2": "Закупівля товарів",
  "3": "Зарплата співробітникам",
  "4": "Податки та збори",
  "5": "Надання послуг",
  "7": "Продаж товарів",
  "8": "Інші доходи",
  "9": "Інші витрати",
  "10": "Поповнення рахунку",
  "11": "Комісія за еквайринг",
  "159536": "Канцелярські, миючі товари та засоби",
  "159537": "Продукти для гостей",
  "159538": "Доставка товарів ( Нова Пошта)",
  "160068": "Інтернет, CRM, IP і т. д.",
  "160069": "Маркетинг CMM",
  "160070": "Оренда",
  "160071": "Реклама, Бюджет, ФБ",
  "160254": "Управління",
  "160368": "Балансування рахунку",
  "161464": "Інструменти салону",
  "167804": "Інкасація",
  "173821": "Переміщення",
  "174865": "Таргет оплата роботи маркетологів",
  "175001": "Завдатки клієнтів які не прийшли",
  "176657": "Інвестиції в салон",
  "180254": "Управління",
  "180293": "Дірект",
  "180296": "Бухгалтерія",
  "180299": "Податки та збори",
  "181619": "Повернення",
  "183747": "Ремонт обладнання, інструментів",
  "184506": "Комісійні % за продаж волосся",
  "184507": "Прибирання Салону",
};

const UKRAINIAN_PURPOSE_TITLES_BY_KEY = new Map(
  [
    ["acquiring", "Комісія за еквайринг"],
    ["acquiring fee", "Комісія за еквайринг"],
    ["accounting", "Бухгалтерія"],
    ["балансування рахунку", "Балансування рахунку"],
    ["бухгалтерія", "Бухгалтерія"],
    ["client account top up", "Поповнення рахунку"],
    ["consumables purchase", "Закупівля матеріалів"],
    ["direct", "Дірект"],
    ["miscellaneous expenses", "Інші витрати"],
    ["miscellaneous income", "Інші доходи"],
    ["product purchase", "Закупівля товарів"],
    ["product sales", "Продаж товарів"],
    ["rent", "Оренда"],
    ["return", "Повернення"],
    ["returns", "Повернення"],
    ["service payments", "Надання послуг"],
    ["taxes and fees", "Податки та збори"],
    ["team salaries", "Зарплата співробітникам"],
  ].map(([key, title]) => [normalizePaymentPurposeTitle(key), title]),
);

export function canonicalizeAltegioPaymentPurposeTitle(title: string, externalId: string): string {
  const byExternalId = UKRAINIAN_PURPOSE_TITLES_BY_EXTERNAL_ID[externalId];
  if (byExternalId) return byExternalId;
  return UKRAINIAN_PURPOSE_TITLES_BY_KEY.get(normalizePaymentPurposeTitle(title)) || title;
}

/** Призначення з raw Altegio: текстові поля + expense_id (напр. 10 = Поповнення рахунку). */
export function resolveAltegioPaymentPurposeFromRaw(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw) return null;
  const expense = asRecord(raw.expense);
  const externalId = toInt(raw.expense_id ?? raw.expenseId ?? expense?.id);
  const rawTitle = pickCategoryTitle(
    raw.payment_purpose,
    raw.paymentPurpose,
    raw.purpose,
    raw.comment,
    raw.title,
    expense?.title,
    expense?.name,
    expense?.category,
    asRecord(raw.category)?.title,
    asRecord(raw.category)?.name,
    asRecord(raw.expense)?.title,
    asRecord(raw.expense)?.name,
  );
  if (externalId) {
    return canonicalizeAltegioPaymentPurposeTitle(rawTitle || "", String(externalId));
  }
  return rawTitle;
}

function unwrapRows(raw: unknown): RawRecord[] {
  if (Array.isArray(raw)) return raw.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
  const root = asRecord(raw);
  if (!root) return [];

  const direct = root.data ?? root.transactions ?? root.items;
  if (Array.isArray(direct)) return direct.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);

  const nested = asRecord(root.data);
  if (!nested) return [];
  const nestedRows = nested.data ?? nested.transactions ?? nested.items;
  return Array.isArray(nestedRows)
    ? nestedRows.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null)
    : [];
}

async function fetchFinanceRows(params: {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  maxPages: number;
}): Promise<{ rows: RawRecord[]; warnings: string[] }> {
  const rows: RawRecord[] = [];
  const warnings: string[] = [];
  const endpointTemplates = [
    {
      sourceEndpoint: "GET /transactions/{locationId}",
      path: (page: number) => `/transactions/${params.companyId}?${new URLSearchParams({
        start_date: params.dateFrom,
        end_date: params.dateTo,
        deleted: "0",
        count: "1000",
        page: String(page),
      }).toString()}`,
    },
    {
      sourceEndpoint: "GET /finance_transactions/{locationId}",
      path: (page: number) => `/finance_transactions/${params.companyId}?${new URLSearchParams({
        start_date: params.dateFrom,
        end_date: params.dateTo,
        deleted: "0",
        count: "1000",
        page: String(page),
      }).toString()}`,
    },
    {
      sourceEndpoint: "GET /transactions/{locationId} date_from/date_to",
      path: (page: number) => `/transactions/${params.companyId}?${new URLSearchParams({
        date_from: params.dateFrom,
        date_to: params.dateTo,
        deleted: "0",
        count: "1000",
        page: String(page),
      }).toString()}`,
    },
  ];

  const seenTransactionIds = new Set<string>();
  for (const endpoint of endpointTemplates) {
    for (let page = 1; page <= params.maxPages; page += 1) {
      try {
        const raw = await altegioFetch<unknown>(endpoint.path(page));
        const pageRows = unwrapRows(raw);
        if (pageRows.length === 0) break;

        for (const row of pageRows) {
          const id = String(row.id ?? row.transaction_id ?? `${endpoint.sourceEndpoint}:${page}:${rows.length}`);
          if (seenTransactionIds.has(id)) continue;
          seenTransactionIds.add(id);
          rows.push({ ...row, __sourceEndpoint: endpoint.sourceEndpoint });
        }

        if (pageRows.length < 1000) break;
      } catch (error) {
        warnings.push(`${endpoint.sourceEndpoint} page ${page}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }

  return { rows, warnings };
}

function extractPurposeFromRow(row: RawRecord): {
  externalId: string;
  title: string;
  transactionId: number | null;
  sourceEndpoint: string;
} | null {
  const expense = asRecord(row.expense);
  const externalId = toInt(row.expense_id ?? row.expenseId ?? expense?.id);
  const rawTitle = pickCategoryTitle(expense?.title, expense?.name, expense?.category);
  const title = externalId && rawTitle ? canonicalizeAltegioPaymentPurposeTitle(rawTitle, String(externalId)) : null;
  if (!externalId || !title) return null;

  return {
    externalId: String(externalId),
    title,
    transactionId: toInt(row.id ?? row.transaction_id),
    sourceEndpoint: cleanText(row.__sourceEndpoint) || "unknown",
  };
}

function extractPurposeFromCategory(category: AltegioExpenseCategory): ImportedAltegioPaymentPurpose | null {
  const externalId = toInt(category.id);
  const rawTitle = pickCategoryTitle(category.title, category.name, category.category);
  const title = externalId && rawTitle ? canonicalizeAltegioPaymentPurposeTitle(rawTitle, String(externalId)) : null;
  if (!externalId || !title) return null;

  const sourceEndpoint = cleanText((category as { __sourceEndpoint?: unknown }).__sourceEndpoint) || "GET /expenses";

  return {
    externalId: String(externalId),
    title,
    normalizedTitle: normalizePaymentPurposeTitle(title),
    occurrences: 0,
    sourceEndpoints: [sourceEndpoint],
    sampleTransactionIds: [],
  };
}

/** Ручні статті, яких ще немає в транзакціях (напр. щойно створена «Термінал»). */
function getManualExpenseCategoryOverrides(): AltegioExpenseCategory[] {
  const overrides: AltegioExpenseCategory[] = [];
  const terminalId = process.env.ALTEGIO_TERMINAL_EXPENSE_ID?.trim();
  if (terminalId && /^\d+$/.test(terminalId)) {
    overrides.push({
      id: Number(terminalId),
      title: "Термінал",
      __sourceEndpoint: "ENV:ALTEGIO_TERMINAL_EXPENSE_ID",
    });
  }
  return overrides;
}

export async function importAltegioPaymentPurposes(params: {
  dateFrom?: string;
  dateTo?: string;
  companyId?: string;
  dryRun?: boolean;
  maxPages?: number;
} = {}): Promise<ImportAltegioPaymentPurposesResult> {
  const companyId = params.companyId || resolveCompanyId();
  const dateFrom = normalizeDateInput(params.dateFrom, ALTEGIO_FINANCE_SYNC_START_DATE);
  const dateTo = normalizeDateInput(params.dateTo, new Date().toISOString().slice(0, 10));
  const dryRun = params.dryRun !== false;
  const maxPages = Math.max(1, Math.min(params.maxPages ?? 5, 20));
  const warnings: string[] = [];
  const byExternalId = new Map<string, ImportedAltegioPaymentPurpose>();
  let fetchedTransactions = 0;
  let categories: AltegioExpenseCategory[] = [];

  try {
    categories = [...(await fetchExpenseCategories()), ...getManualExpenseCategoryOverrides()];
  } catch (error) {
    warnings.push(`GET /expenses: ${error instanceof Error ? error.message : String(error)}`);
    categories = getManualExpenseCategoryOverrides();
  }

  for (const category of categories) {
    const purpose = extractPurposeFromCategory(category);
    if (!purpose) continue;
    byExternalId.set(purpose.externalId, purpose);
  }

  const catalogCount = byExternalId.size;

  const financeRows = await fetchFinanceRows({ companyId, dateFrom, dateTo, maxPages });
  fetchedTransactions = financeRows.rows.length;
  warnings.push(...financeRows.warnings);

  for (const row of financeRows.rows) {
    const purpose = extractPurposeFromRow(row);
    if (!purpose) continue;
    const normalizedTitle = normalizePaymentPurposeTitle(purpose.title);
    const existing = byExternalId.get(purpose.externalId);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.sourceEndpoints.includes(purpose.sourceEndpoint)) {
        existing.sourceEndpoints.push(purpose.sourceEndpoint);
      }
      if (purpose.transactionId && existing.sampleTransactionIds.length < 5) {
        existing.sampleTransactionIds.push(purpose.transactionId);
      }
      continue;
    }

    byExternalId.set(purpose.externalId, {
      externalId: purpose.externalId,
      title: purpose.title,
      normalizedTitle,
      occurrences: 1,
      sourceEndpoints: [purpose.sourceEndpoint],
      sampleTransactionIds: purpose.transactionId ? [purpose.transactionId] : [],
    });
  }

  const transactionOnlyCount = Math.max(0, byExternalId.size - catalogCount);

  const purposes = Array.from(byExternalId.values()).sort((a, b) => a.title.localeCompare(b.title, "uk"));
  const hasTerminal = purposes.some((purpose) => purpose.normalizedTitle.includes("термінал"));
  let upserted = 0;

  if (!dryRun) {
    const externalIds = purposes.map((purpose) => purpose.externalId);
    const normalizedTitles = purposes.map((purpose) => purpose.normalizedTitle);
    if (externalIds.length > 0) {
      await (prisma as any).altegioPaymentPurpose.updateMany({
        where: {
          companyId,
          externalId: { in: externalIds },
          normalizedTitle: { notIn: normalizedTitles },
          isActive: true,
        },
        data: {
          isActive: false,
          syncedAt: new Date(),
        },
      });
    }

    await (prisma as any).altegioPaymentPurpose.updateMany({
      where: {
        companyId,
        source: "finance_transaction_expense_import",
        isActive: true,
        normalizedTitle: { notIn: normalizedTitles },
      },
      data: {
        isActive: false,
        syncedAt: new Date(),
      },
    });

    for (const purpose of purposes) {
      const existingByTitle = await (prisma as any).altegioPaymentPurpose.findUnique({
        where: { companyId_normalizedTitle: { companyId, normalizedTitle: purpose.normalizedTitle } },
        select: { id: true },
      });

      if (existingByTitle) {
        await (prisma as any).altegioPaymentPurpose.update({
          where: { id: existingByTitle.id },
          data: {
            externalId: purpose.externalId,
            title: purpose.title,
            source: "altegio_expense_category",
            rawData: purpose as object,
            isActive: true,
            syncedAt: new Date(),
          },
        });
        await (prisma as any).altegioPaymentPurpose.updateMany({
          where: {
            companyId,
            externalId: purpose.externalId,
            id: { not: existingByTitle.id },
          },
          data: {
            isActive: false,
            syncedAt: new Date(),
          },
        });
        upserted += 1;
        continue;
      }

      const existingByExternalId = await (prisma as any).altegioPaymentPurpose.findFirst({
        where: { companyId, externalId: purpose.externalId },
        select: { id: true },
      });

      if (existingByExternalId) {
        await (prisma as any).altegioPaymentPurpose.update({
          where: { id: existingByExternalId.id },
          data: {
          title: purpose.title,
            normalizedTitle: purpose.normalizedTitle,
          source: "altegio_expense_category",
          rawData: purpose as object,
          isActive: true,
          syncedAt: new Date(),
        },
        });
        upserted += 1;
        continue;
      }

      await (prisma as any).altegioPaymentPurpose.create({
        data: {
          companyId,
          externalId: purpose.externalId,
          title: purpose.title,
          normalizedTitle: purpose.normalizedTitle,
          source: "altegio_expense_category",
          rawData: purpose as object,
          isActive: true,
          syncedAt: new Date(),
        },
      });
      upserted += 1;
    }
  }

  console.log("[altegio/payment-purpose-import] Імпорт статей завершено", {
    companyId,
    dateFrom,
    dateTo,
    dryRun,
    fetchedTransactions,
    catalogCount,
    transactionOnlyCount,
    hasTerminal,
    foundPurposes: purposes.length,
    upserted,
    warnings: warnings.slice(0, 5),
  });

  return {
    ok: true,
    companyId,
    dateFrom,
    dateTo,
    dryRun,
    fetchedTransactions,
    catalogCount,
    transactionOnlyCount,
    hasTerminal,
    foundPurposes: purposes.length,
    upserted,
    purposes,
    warnings,
  };
}
