// Фінансові документи Kresco. Ручні прихід/розхід/переміщення лишаються лише тут, в Altegio не йдуть.

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import {
  hiddenFinanceAccountIds,
  listFinanceAccountArchive,
  pausedBankAltegioAccountIds,
} from "@/lib/finance/account-archive";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import { normalizePaymentPurposeTitle } from "@/lib/altegio/finance-transactions-sync";

/** Статті, створені в Креско: без id Altegio, вид у source. */
const KRESCO_PURPOSE_SOURCES = ["kresco_income", "kresco_expense"];

function isKrescoPurposeSource(source: string | null | undefined): boolean {
  return KRESCO_PURPOSE_SOURCES.includes(String(source || ""));
}

type DocumentCurrency = "UAH" | "USD" | "EUR";

function documentCurrency(title: string): DocumentCurrency {
  if (isUsdCashAccountTitle(title)) return "USD";
  if (isEurCashAccountTitle(title)) return "EUR";
  return "UAH";
}

/** Робочий курс із банку: свій день або найближчий попередній. Один запит. */
async function workingRateOn(kyivDay: string, currency: "USD" | "EUR"): Promise<number> {
  const row = await prisma.dailyFxRate.findFirst({
    where: { kyivDay: { lte: kyivDay } },
    orderBy: { kyivDay: "desc" },
    select: { usdWorking: true, eurWorking: true },
  });
  const rate = row ? (currency === "USD" ? row.usdWorking : row.eurWorking) : 0;
  if (!(rate > 0)) throw new Error(`Курс ${currency} на ${kyivDay} не знайдено`);
  return rate;
}

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveCompanyId(): string {
  return (
    process.env.ALTEGIO_COMPANY_ID?.trim() ||
    ALTEGIO_ENV.PARTNER_ID ||
    ALTEGIO_ENV.APPLICATION_ID ||
    ""
  );
}

export type FinanceDocType = "income" | "expense" | "transfer";

export type CreateFinanceDocumentInput = {
  type: FinanceDocType;
  amountUah?: number;
  /** Сума у валюті рахунку */
  amount?: number;
  /** Для обміну між валютами: сума у валюті рахунку призначення */
  counterAmount?: number;
  accountId: number;
  counterAccountId?: number | null;
  purposeId?: string | null;
  purposeExternalId?: number | null;
  purposeTitle?: string | null;
  occurredAt?: string | Date | null;
  comment?: string | null;
  createdBy?: string | null;
};

export async function listFinanceDocuments(params?: { limit?: number; type?: string }) {
  const take = Math.min(Math.max(Number(params?.limit) || 50, 1), 200);
  return prisma.financeDocument.findMany({
    where: params?.type ? { type: params.type } : undefined,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take,
  });
}

export async function listFinanceFormOptions() {
  const companyId = resolveCompanyId();
  const [accounts, purposes, hiddenIds, pausedIds, accountArchive, expenseGroups] = await Promise.all([
    fetchAltegioAccounts(),
    prisma.altegioPaymentPurpose.findMany({
      where: {
        isActive: true,
        ...(companyId ? { companyId } : {}),
        OR: [{ externalId: { not: null } }, { source: { in: KRESCO_PURPOSE_SOURCES } }],
      },
      orderBy: { title: "asc" },
      take: 500,
    }),
    hiddenFinanceAccountIds(),
    pausedBankAltegioAccountIds(),
    listFinanceAccountArchive(),
    prisma.financeExpenseGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  return {
    accounts: accounts
      .map((a) => ({ id: Number(a.id), title: a.title, type: a.type }))
      .filter((a) => a.id > 0 && !hiddenIds.has(a.id) && !pausedIds.has(a.id)),
    accountArchive,
    expenseGroups: expenseGroups.map((group) => ({ id: group.id, title: group.title })),
    purposes: purposes.map((p) => ({
      id: p.id,
      title: p.title,
      externalId: p.externalId ? Number(p.externalId) : null,
      source: p.source,
      groupId: p.groupId,
    })),
  };
}

export async function createFinanceDocument(input: CreateFinanceDocumentInput) {
  const type = input.type;
  if (type !== "income" && type !== "expense" && type !== "transfer") {
    throw new Error("Тип: income | expense | transfer");
  }

  // amount — у валюті рахунку; amountUah лишається для старих викликів
  const amount = toMoney(Number(input.amount ?? input.amountUah) || 0);
  if (!(amount > 0)) throw new Error("Сума має бути більше 0");

  const accountId = Number(input.accountId) || 0;
  if (!(accountId > 0)) throw new Error("Оберіть рахунок");

  const options = await listFinanceFormOptions();
  const account = options.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Рахунок Altegio не знайдено");

  let counterAccountId: number | null = null;
  let counterAccountTitle: string | null = null;
  if (type === "transfer") {
    counterAccountId = Number(input.counterAccountId) || 0;
    if (!(counterAccountId > 0)) throw new Error("Оберіть рахунок призначення");
    const counter = options.accounts.find((a) => a.id === counterAccountId);
    if (!counter) throw new Error("Рахунок призначення не знайдено");
    counterAccountTitle = counter.title;
  }

  let purposeId = input.purposeId ? String(input.purposeId) : null;
  let purposeTitle = input.purposeTitle ? String(input.purposeTitle).trim() : null;
  let purposeExternalId = input.purposeExternalId != null ? Number(input.purposeExternalId) : null;

  if (type !== "transfer") {
    if (purposeId) {
      const p = options.purposes.find((x) => x.id === purposeId);
      if (p) {
        purposeTitle = p.title;
        purposeExternalId = p.externalId;
      }
    }
    const krescoPurpose = isKrescoPurposeSource(options.purposes.find((x) => x.id === purposeId)?.source);
    if (!krescoPurpose && !(purposeExternalId && purposeExternalId > 0)) {
      throw new Error("Оберіть статтю");
    }
    if (!purposeTitle) purposeTitle = "Стаття";
  } else {
    purposeTitle = "Переміщення";
    purposeExternalId = null;
    purposeId = null;
  }

  const occurredAt = input.occurredAt
    ? input.occurredAt instanceof Date
      ? input.occurredAt
      : new Date(input.occurredAt)
    : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Некоректна дата");
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const currency = documentCurrency(account.title);
  const counterCurrency = counterAccountTitle ? documentCurrency(counterAccountTitle) : null;
  // Обмін між валютами: скільки реально зайшло на рахунок призначення вводить людина
  const counterAmount =
    counterCurrency == null || counterCurrency === currency ? amount : toMoney(Number(input.counterAmount) || 0);
  if (counterCurrency != null && !(counterAmount > 0)) {
    throw new Error("Сума на рахунку призначення має бути більше 0");
  }
  let amountUah = amount;
  if (currency !== "UAH") {
    amountUah =
      counterCurrency === "UAH" ? counterAmount : Math.round(amount * (await workingRateOn(kyivDay, currency)));
  }

  const doc = await prisma.financeDocument.create({
    data: {
      type,
      status: "posted",
      syncStatus: "local",
      syncError: null,
      source: "kresco",
      title: purposeTitle,
      amountUah,
      currency,
      amountFx: currency === "UAH" ? null : amount,
      counterCurrency,
      counterAmountFx: counterCurrency == null || counterCurrency === "UAH" ? null : counterAmount,
      kyivDay,
      occurredAt,
      accountId,
      accountTitle: account.title,
      counterAccountId,
      counterAccountTitle,
      purposeId,
      purposeTitle,
      purposeExternalId,
      comment: input.comment ? String(input.comment).slice(0, 1000) : null,
      createdBy: input.createdBy || null,
    },
  });

  console.log(`[finance/documents] ${type} ${amount} ${currency} (${amountUah} грн) doc=${doc.id} лише Kresco`);
  return doc;
}

/** Нова стаття доходу чи витрати лише в Креско. Та сама назва повертає наявну статтю. */
export async function createKrescoPaymentPurpose(input: { title: unknown; kind: unknown; groupId?: unknown }) {
  const title = String(input.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!title) throw new Error("Вкажіть назву статті");
  const kind = input.kind === "income" ? "income" : input.kind === "expense" ? "expense" : null;
  if (!kind) throw new Error("Тип статті: income | expense");
  // Стаття розходу завжди в групі
  const groupId = kind === "expense" ? String(input.groupId || "").trim() : "";
  if (kind === "expense") {
    if (!groupId) throw new Error("Оберіть групу розходу");
    const group = await prisma.financeExpenseGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) throw new Error("Групу розходу не знайдено");
  }
  const companyId = resolveCompanyId();
  const normalizedTitle = normalizePaymentPurposeTitle(title);
  const existing = await prisma.altegioPaymentPurpose.findUnique({
    where: { companyId_normalizedTitle: { companyId, normalizedTitle } },
  });
  if (existing) {
    if (existing.isActive && (!groupId || existing.groupId === groupId)) return existing;
    return prisma.altegioPaymentPurpose.update({
      where: { id: existing.id },
      data: { isActive: true, ...(groupId ? { groupId } : {}) },
    });
  }
  const purpose = await prisma.altegioPaymentPurpose.create({
    data: { companyId, title, normalizedTitle, source: `kresco_${kind}`, isActive: true, groupId: groupId || null },
  });
  console.log(`[finance/documents] Нова стаття Креско «${title}» (${kind}) id=${purpose.id}`);
  return purpose;
}

/** Нова група розходу; стає перед «Інше». Та сама назва повертає наявну групу. */
export async function createFinanceExpenseGroup(input: { title: unknown }) {
  const title = String(input.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!title) throw new Error("Вкажіть назву групи");
  if (title.toLowerCase() === "інше") throw new Error("Група «Інше» вже є");
  const existing = await prisma.financeExpenseGroup.findUnique({ where: { title } });
  if (existing) return existing;
  const last = await prisma.financeExpenseGroup.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const group = await prisma.financeExpenseGroup.create({ data: { title, sortOrder: (last?.sortOrder ?? 0) + 10 } });
  console.log(`[finance/documents] Нова група розходу «${title}» id=${group.id}`);
  return group;
}
