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
  const [accounts, purposes, hiddenIds, pausedIds, accountArchive] = await Promise.all([
    fetchAltegioAccounts(),
    prisma.altegioPaymentPurpose.findMany({
      where: {
        isActive: true,
        ...(companyId ? { companyId } : {}),
        externalId: { not: null },
      },
      orderBy: { title: "asc" },
      take: 500,
    }),
    hiddenFinanceAccountIds(),
    pausedBankAltegioAccountIds(),
    listFinanceAccountArchive(),
  ]);

  return {
    accounts: accounts
      .map((a) => ({ id: Number(a.id), title: a.title, type: a.type }))
      .filter((a) => a.id > 0 && !hiddenIds.has(a.id) && !pausedIds.has(a.id)),
    accountArchive,
    purposes: purposes.map((p) => ({
      id: p.id,
      title: p.title,
      externalId: p.externalId ? Number(p.externalId) : null,
      source: p.source,
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
    if (!(purposeExternalId && purposeExternalId > 0)) {
      throw new Error("Оберіть статтю з каталогу (потрібен id Altegio)");
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
      counterCurrency === "UAH" ? counterAmount : toMoney(amount * (await workingRateOn(kyivDay, currency)));
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
