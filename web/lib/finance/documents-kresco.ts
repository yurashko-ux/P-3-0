// Фінансові документи Kresco з dual-write в Altegio (етап 6).

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { createManualAltegioFinanceDocument } from "@/lib/altegio/finance-transactions-create";
import { ALTEGIO_ENV } from "@/lib/altegio/env";

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
  amountUah: number;
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
  const [accounts, purposes] = await Promise.all([
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
  ]);

  return {
    accounts: accounts
      .map((a) => ({ id: Number(a.id), title: a.title, type: a.type }))
      .filter((a) => a.id > 0),
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

  const amountUah = toMoney(Number(input.amountUah) || 0);
  if (!(amountUah > 0)) throw new Error("Сума має бути більше 0");

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

  const doc = await prisma.financeDocument.create({
    data: {
      type,
      status: "pending",
      syncStatus: "pending",
      source: "kresco",
      title: purposeTitle,
      amountUah,
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

  try {
    const result = await createManualAltegioFinanceDocument({
      type,
      accountId,
      accountTitle: account.title,
      counterAccountId,
      counterAccountTitle,
      expenseId: purposeExternalId,
      purposeTitle,
      amountUah,
      occurredAt,
      comment: input.comment,
    });

    const updated = await prisma.financeDocument.update({
      where: { id: doc.id },
      data: {
        status: "posted",
        syncStatus: "synced",
        syncError: null,
        altegioTransactionId: result.source.altegioId,
        localAltegioTxId: result.source.id,
        altegioCounterTransactionId: result.target?.altegioId ?? null,
        localAltegioCounterTxId: result.target?.id ?? null,
      },
    });

    console.log(
      `[finance/documents] ✅ ${type} ${amountUah} грн doc=${doc.id} altegio=${result.source.altegioId}`,
    );
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.financeDocument.update({
      where: { id: doc.id },
      data: { status: "sync_error", syncStatus: "error", syncError: message },
    });
    console.error(`[finance/documents] Помилка dual-write doc=${doc.id}:`, message);
    throw new Error(message);
  }
}
