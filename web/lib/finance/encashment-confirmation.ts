// Підтвердження інкасації: відправка власниці та облік статусів.

import { prisma } from "@/lib/prisma";
import { fetchExpensesSummary } from "@/lib/altegio";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import type { AltegioFinanceTransaction } from "@/lib/altegio/expenses";
import type { AuthContext } from "@/lib/auth-rbac";
import {
  bucketLabelUa,
  formatEncashmentAmount,
  isEncashmentTransaction,
  resolveEncashmentAmounts,
  type EncashmentAccountBucket,
} from "@/lib/finance/encashment-account-bucket";
import { getEncashmentOwnerChatIds, getDeveloperRecipients, getSalonOwnerRecipients } from "@/lib/finance/encashment-owner-chats";
import {
  computeEncashmentOwnerReceiptTotals,
  buildEncashmentReceiptDisplay,
  type EncashmentOwnerReceiptTotals,
  type EncashmentReceiptDisplay,
  type EncashmentFactTotals,
} from "@/lib/finance/encashment-receipt-totals";
import { getFinanceReportEncashmentTotalUah } from "@/lib/finance/finance-report-encashment-total";
import { sendEncashmentOwnerTelegram, syncEncashmentOwnerTelegramMessagesForPeriod } from "@/lib/finance/encashment-confirmation-telegram";

export type EncashmentPaymentStatus = "not_sent" | "pending_owner" | "owner_confirmed" | "rejected" | "cancelled";

export type EncashmentPaymentRow = {
  altegioId: number;
  operationDate: string;
  accountTitle: string;
  bucket: EncashmentAccountBucket;
  bucketLabel: string;
  displayAmount: string;
  amountUAH: number;
  foreignAmount: number | null;
  foreignCurrency: string | null;
  status: EncashmentPaymentStatus;
  confirmationId: string | null;
  ownerConfirmedAt: string | null;
  comment: string | null;
};

export type EncashmentBucketSummary = {
  bucket: EncashmentAccountBucket;
  label: string;
  totalAmount: number;
  totalForeign: number | null;
  foreignCurrency: string | null;
  confirmedAmount: number;
  confirmedForeign: number | null;
  paymentCount: number;
  confirmedCount: number;
};

export type EncashmentConfirmationSummary = {
  year: number;
  month: number;
  periodStatus: "open" | "partially_confirmed" | "closed";
  periodClosedAt: string | null;
  buckets: EncashmentBucketSummary[];
  payments: EncashmentPaymentRow[];
  ownerChatIdsConfigured: boolean;
  ownerSetupHint: string | null;
};

export type { EncashmentOwnerReceiptTotals, EncashmentReceiptAmounts, EncashmentReceiptDisplay, EncashmentFactTotals } from "@/lib/finance/encashment-receipt-totals";
export {
  computeEncashmentOwnerReceiptTotals,
  formatEncashmentReceiptAmounts,
  buildEncashmentReceiptDisplay,
  formatEncashmentReceiptDisplayUah,
  formatEncashmentReceiptDisplayReceived,
  formatEncashmentReceiptDisplayPending,
} from "@/lib/finance/encashment-receipt-totals";

function formatConfirmationDisplayAmountFromRow(row: {
  accountBucket: string;
  amountKopiykas: bigint;
  foreignAmount: { toString(): string } | null;
}): string {
  const bucket = row.accountBucket as EncashmentAccountBucket;
  const amountUAH = Number(row.amountKopiykas) / 100;
  const foreignRaw = row.foreignAmount != null ? Number(row.foreignAmount) : null;
  const foreign = foreignRaw != null && Number.isFinite(foreignRaw) ? foreignRaw : null;

  if (bucket === "usd") {
    const amt = foreign != null && foreign > 0 ? foreign : amountUAH;
    return `${formatEncashmentAmount(amt)} $`;
  }
  if (bucket === "eur") {
    const amt = foreign != null && foreign > 0 ? foreign : amountUAH;
    return `${formatEncashmentAmount(amt)} EUR`;
  }
  return `${formatEncashmentAmount(amountUAH)} грн.`;
}

function confirmationRowToReceiptPayment(
  row: Awaited<ReturnType<typeof prisma.encashmentConfirmation.findMany>>[number],
): EncashmentPaymentRow {
  const bucket = row.accountBucket as EncashmentAccountBucket;
  const foreignRaw = row.foreignAmount != null ? Number(row.foreignAmount) : null;
  const foreignAmount = foreignRaw != null && Number.isFinite(foreignRaw) ? foreignRaw : null;

  return {
    altegioId: row.altegioId,
    operationDate: row.operationDate.toISOString().slice(0, 10),
    accountTitle: row.accountTitle || "—",
    bucket,
    bucketLabel: bucketLabelUa(bucket),
    displayAmount: formatConfirmationDisplayAmountFromRow(row),
    amountUAH: Number(row.amountKopiykas) / 100,
    foreignAmount,
    foreignCurrency: (row.foreignCurrency as "USD" | "EUR" | null) ?? null,
    status: mapConfirmationStatus(row.status),
    confirmationId: row.id,
    ownerConfirmedAt: row.ownerConfirmedAt?.toISOString() ?? null,
    comment: null,
  };
}

export async function getEncashmentOwnerReceiptTotalsForPeriod(
  year: number,
  month: number,
): Promise<EncashmentOwnerReceiptTotals> {
  const companyId = resolveCompanyId();
  const confirmations = await prisma.encashmentConfirmation.findMany({
    where: { reportYear: year, reportMonth: month, companyId },
  });
  return computeEncashmentOwnerReceiptTotals(
    confirmations.map((row) => confirmationRowToReceiptPayment(row)),
  );
}

export async function getEncashmentFactTotalsForPeriod(
  year: number,
  month: number,
): Promise<EncashmentFactTotals> {
  const transactions = await getEncashmentTransactionsForMonth(year, month);
  const totals: EncashmentFactTotals = { cashUAH: 0, fopUAH: 0, usd: 0, eur: 0 };

  for (const tx of transactions) {
    const amounts = resolveEncashmentAmounts(tx);
    if (amounts.bucket === "usd") {
      totals.usd += amounts.foreignAmount ?? amounts.amountUAH;
    } else if (amounts.bucket === "eur") {
      totals.eur += amounts.foreignAmount ?? amounts.amountUAH;
    } else if (amounts.bucket === "cash_uah") {
      totals.cashUAH += amounts.amountUAH;
    } else {
      totals.fopUAH += amounts.amountUAH;
    }
  }

  return totals;
}

export async function getEncashmentOwnerReceiptDisplayForPeriod(
  year: number,
  month: number,
): Promise<EncashmentReceiptDisplay> {
  const companyId = resolveCompanyId();
  const [totalEncashmentUah, factTotals, confirmations] = await Promise.all([
    getFinanceReportEncashmentTotalUah(year, month),
    getEncashmentFactTotalsForPeriod(year, month),
    prisma.encashmentConfirmation.findMany({
      where: { reportYear: year, reportMonth: month, companyId },
    }),
  ]);
  return buildEncashmentReceiptDisplay(
    totalEncashmentUah,
    confirmations.map((row) => confirmationRowToReceiptPayment(row)),
    factTotals,
  );
}

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  return fromEnv || fallback || "";
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: formatDateISO(from), to: formatDateISO(to) };
}

function mapConfirmationStatus(dbStatus: string | null | undefined): EncashmentPaymentStatus {
  if (!dbStatus) return "not_sent";
  if (dbStatus === "pending_owner") return "pending_owner";
  if (dbStatus === "owner_confirmed") return "owner_confirmed";
  if (dbStatus === "rejected") return "rejected";
  if (dbStatus === "cancelled") return "cancelled";
  return "not_sent";
}

function emptyBuckets(): EncashmentBucketSummary[] {
  return (["cash_uah", "fop_uah", "usd", "eur"] as EncashmentAccountBucket[]).map((bucket) => ({
    bucket,
    label: bucketLabelUa(bucket),
    totalAmount: 0,
    totalForeign: bucket === "usd" || bucket === "eur" ? 0 : null,
    foreignCurrency: bucket === "usd" ? "USD" : bucket === "eur" ? "EUR" : null,
    confirmedAmount: 0,
    confirmedForeign: bucket === "usd" || bucket === "eur" ? 0 : null,
    paymentCount: 0,
    confirmedCount: 0,
  }));
}

export async function getEncashmentTransactionsForMonth(
  year: number,
  month: number,
): Promise<AltegioFinanceTransaction[]> {
  const { from, to } = monthRange(year, month);
  const expenses = await fetchExpensesSummary({ date_from: from, date_to: to });
  if (!Array.isArray(expenses?.transactions)) return [];
  return expenses.transactions.filter((tx) => isEncashmentTransaction(tx) && !tx.deleted);
}

export async function getEncashmentConfirmationSummary(
  year: number,
  month: number,
): Promise<EncashmentConfirmationSummary> {
  const companyId = resolveCompanyId();
  const transactions = await getEncashmentTransactionsForMonth(year, month);

  const confirmations = await prisma.encashmentConfirmation.findMany({
    where: { reportYear: year, reportMonth: month, companyId },
  });

  const confirmationByAltegioId = new Map<number, (typeof confirmations)[0]>();
  for (const row of confirmations) {
    confirmationByAltegioId.set(row.altegioId, row);
  }

  const periodRow = await prisma.encashmentPeriodStatus.findUnique({
    where: { year_month: { year, month } },
  });

  const buckets = emptyBuckets();
  const bucketIndex = new Map(buckets.map((b) => [b.bucket, b]));

  const payments: EncashmentPaymentRow[] = [];

  for (const tx of transactions) {
    const amounts = resolveEncashmentAmounts(tx);
    const confirmation = confirmationByAltegioId.get(tx.id);
    const status = mapConfirmationStatus(confirmation?.status);
    const bucketSummary = bucketIndex.get(amounts.bucket)!;

    bucketSummary.paymentCount += 1;
    if (amounts.bucket === "usd" || amounts.bucket === "eur") {
      const foreign = amounts.foreignAmount ?? 0;
      bucketSummary.totalForeign = (bucketSummary.totalForeign ?? 0) + foreign;
    } else {
      bucketSummary.totalAmount += amounts.amountUAH;
    }

    if (status === "owner_confirmed") {
      bucketSummary.confirmedCount += 1;
      if (amounts.bucket === "usd" || amounts.bucket === "eur") {
        const foreign = amounts.foreignAmount ?? 0;
        bucketSummary.confirmedForeign = (bucketSummary.confirmedForeign ?? 0) + foreign;
      } else {
        bucketSummary.confirmedAmount += amounts.amountUAH;
      }
    }

    payments.push({
      altegioId: tx.id,
      operationDate: tx.date,
      accountTitle: tx.account?.title || tx.account?.name || "—",
      bucket: amounts.bucket,
      bucketLabel: bucketLabelUa(amounts.bucket),
      displayAmount: amounts.displayAmount,
      amountUAH: amounts.amountUAH,
      foreignAmount: amounts.foreignAmount,
      foreignCurrency: amounts.foreignCurrency,
      status,
      confirmationId: confirmation?.id ?? null,
      ownerConfirmedAt: confirmation?.ownerConfirmedAt?.toISOString() ?? null,
      comment: String(tx.comment || "").trim() || null,
    });
  }

  payments.sort((a, b) => String(a.operationDate).localeCompare(String(b.operationDate)));

  const ownerChatIds = await getEncashmentOwnerChatIds();
  const owners = await getSalonOwnerRecipients();
  const developers = await getDeveloperRecipients();

  let ownerSetupHint: string | null = null;
  if (ownerChatIds.length === 0) {
    const ownersWithoutChat = owners.filter((o) => o.chatId == null);
    const developersWithoutChat = developers.filter((d) => d.chatId == null);
    const hints: string[] = [];

    if (ownersWithoutChat.length > 0) {
      const names = ownersWithoutChat
        .map((o) => `${o.name}${o.telegramUsername ? ` (@${o.telegramUsername})` : ""}`)
        .join(", ");
      hints.push(`${names} — /start у боті звітів`);
    }
    if (developersWithoutChat.length > 0) {
      const names = developersWithoutChat
        .map((d) => `${d.name}${d.telegramUsername ? ` (@${d.telegramUsername})` : ""}`)
        .join(", ");
      hints.push(`Для тесту: ${names} — /start у боті звітів`);
    }
    if (hints.length > 0) {
      ownerSetupHint = `${hints.join(". ")}. Натисніть «Підключити бот звітів» нижче.`;
    } else if (owners.length === 0 && developers.length === 0) {
      ownerSetupHint = "У Доступах немає користувача з посадою «Власник» або «Розробник»";
    } else {
      ownerSetupHint = "Натисніть /start у боті звітів (власниця або розробник)";
    }
  }

  return {
    year,
    month,
    periodStatus: (periodRow?.status as EncashmentConfirmationSummary["periodStatus"]) || "open",
    periodClosedAt: periodRow?.closedAt?.toISOString() ?? null,
    buckets,
    payments,
    ownerChatIdsConfigured: ownerChatIds.length > 0,
    ownerSetupHint,
  };
}

export async function recomputeEncashmentPeriodStatus(year: number, month: number): Promise<void> {
  const summary = await getEncashmentConfirmationSummary(year, month);
  const totalPayments = summary.payments.length;
  const confirmedPayments = summary.payments.filter((p) => p.status === "owner_confirmed").length;

  let status: "open" | "partially_confirmed" | "closed" = "open";
  let closedAt: Date | null = null;

  if (totalPayments > 0 && confirmedPayments === totalPayments) {
    status = "closed";
    closedAt = new Date();
  } else if (confirmedPayments > 0) {
    status = "partially_confirmed";
  }

  await prisma.encashmentPeriodStatus.upsert({
    where: { year_month: { year, month } },
    create: { year, month, status, closedAt },
    update: {
      status,
      closedAt: status === "closed" ? closedAt : null,
    },
  });
}

export async function sendEncashmentForOwnerConfirmation(params: {
  year: number;
  month: number;
  altegioIds: number[];
  sentBy?: string | null;
}): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const companyId = resolveCompanyId();
  const ownerChatIds = await getEncashmentOwnerChatIds();
  if (ownerChatIds.length === 0) {
    const owners = await getSalonOwnerRecipients();
    const developers = await getDeveloperRecipients();
    const hints: string[] = [
      "Спочатку натисніть «Підключити бот звітів» у фінзвіті, потім /start у Telegram-боті ZVIT_HoB_",
    ];

    const ownersWithoutChat = owners.filter((o) => o.chatId == null);
    const developersWithoutChat = developers.filter((d) => d.chatId == null);

    if (ownersWithoutChat.length > 0) {
      const names = ownersWithoutChat
        .map((o) => `${o.name}${o.telegramUsername ? ` (@${o.telegramUsername})` : ""}`)
        .join(", ");
      hints.push(`${names} — /start у боті звітів`);
    }
    if (developersWithoutChat.length > 0) {
      const names = developersWithoutChat
        .map((d) => `${d.name}${d.telegramUsername ? ` (@${d.telegramUsername})` : ""}`)
        .join(", ");
      hints.push(`Для тесту: ${names} — /start у боті звітів`);
    }

    throw new Error(hints.join(". "));
  }

  const transactions = await getEncashmentTransactionsForMonth(params.year, params.month);
  const txById = new Map(transactions.map((tx) => [tx.id, tx]));

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const altegioId of params.altegioIds) {
    const tx = txById.get(altegioId);
    if (!tx) {
      errors.push(`Altegio ID ${altegioId}: не знайдено серед інкасацій за період`);
      continue;
    }

    const existing = await prisma.encashmentConfirmation.findUnique({
      where: { companyId_altegioId: { companyId, altegioId } },
    });

    if (existing && (existing.status === "pending_owner" || existing.status === "owner_confirmed")) {
      skipped += 1;
      continue;
    }

    const amounts = resolveEncashmentAmounts(tx);
    const operationDate = new Date(tx.date);
    const localTx = await prisma.altegioFinanceTransaction.findUnique({
      where: { companyId_altegioId: { companyId, altegioId } },
      select: { id: true },
    });

    const confirmation = await prisma.encashmentConfirmation.upsert({
      where: { companyId_altegioId: { companyId, altegioId } },
      create: {
        companyId,
        altegioId,
        altegioFinanceTransactionId: localTx?.id ?? null,
        reportYear: params.year,
        reportMonth: params.month,
        accountBucket: amounts.bucket,
        amountKopiykas: BigInt(Math.round(amounts.amountUAH * 100)),
        foreignAmount: amounts.foreignAmount,
        foreignCurrency: amounts.foreignCurrency,
        accountTitle: tx.account?.title || tx.account?.name || null,
        operationDate,
        status: "pending_owner",
        sentAt: new Date(),
        sentBy: params.sentBy ?? null,
      },
      update: {
        altegioFinanceTransactionId: localTx?.id ?? null,
        reportYear: params.year,
        reportMonth: params.month,
        accountBucket: amounts.bucket,
        amountKopiykas: BigInt(Math.round(amounts.amountUAH * 100)),
        foreignAmount: amounts.foreignAmount,
        foreignCurrency: amounts.foreignCurrency,
        accountTitle: tx.account?.title || tx.account?.name || null,
        operationDate,
        status: "pending_owner",
        sentAt: new Date(),
        sentBy: params.sentBy ?? null,
        ownerConfirmedAt: null,
        ownerConfirmedByChatId: null,
        telegramOwnerMessageId: null,
        telegramOwnerChatId: null,
      },
    });

    try {
      const receiptDisplay = await getEncashmentOwnerReceiptDisplayForPeriod(params.year, params.month);

      const messageIds = await sendEncashmentOwnerTelegram({
        confirmationId: confirmation.id,
        year: params.year,
        month: params.month,
        accountTitle: confirmation.accountTitle || "—",
        bucket: amounts.bucket,
        displayAmount: amounts.displayAmount,
        operationDate: tx.date,
        ownerChatIds,
        receiptDisplay,
      });

      if (messageIds.length > 0) {
        const first = messageIds[0];
        await prisma.encashmentConfirmation.update({
          where: { id: confirmation.id },
          data: {
            telegramOwnerMessageId: first.messageId,
            telegramOwnerChatId: BigInt(first.chatId),
          },
        });
      }

      sent += 1;
      await syncEncashmentOwnerTelegramMessagesForPeriod(params.year, params.month).catch((err) => {
        console.error("[encashment-confirmation] sync telegram messages error:", err);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Altegio ID ${altegioId}: ${msg}`);
    }
  }

  await recomputeEncashmentPeriodStatus(params.year, params.month);

  return { sent, skipped, errors };
}

export async function confirmEncashmentByOwner(params: {
  confirmationId: string;
  ownerChatId: number;
}): Promise<{ ok: boolean; error?: string; year?: number; month?: number }> {
  const allowedChatIds = await getEncashmentOwnerChatIds();
  if (!allowedChatIds.includes(params.ownerChatId)) {
    return { ok: false, error: "Немає доступу для підтвердження інкасації" };
  }

  const confirmation = await prisma.encashmentConfirmation.findUnique({
    where: { id: params.confirmationId },
  });

  if (!confirmation) {
    return { ok: false, error: "Запит на підтвердження не знайдено" };
  }

  if (confirmation.status === "owner_confirmed") {
    return {
      ok: true,
      year: confirmation.reportYear,
      month: confirmation.reportMonth,
    };
  }

  if (confirmation.status !== "pending_owner") {
    return { ok: false, error: "Цей платіж не очікує підтвердження" };
  }

  await prisma.encashmentConfirmation.update({
    where: { id: params.confirmationId },
    data: {
      status: "owner_confirmed",
      ownerConfirmedAt: new Date(),
      ownerConfirmedByChatId: BigInt(params.ownerChatId),
    },
  });

  await recomputeEncashmentPeriodStatus(confirmation.reportYear, confirmation.reportMonth);

  return {
    ok: true,
    year: confirmation.reportYear,
    month: confirmation.reportMonth,
  };
}

const DEVELOPER_FUNCTION_NAME = "розробник";

export async function canRevokeEncashmentConfirmation(auth: AuthContext): Promise<boolean> {
  if (auth.type === "superadmin") return true;
  if (auth.type !== "user" || !auth.userId) return false;

  const user = await prisma.appUser.findUnique({
    where: { id: auth.userId },
    include: { function: true },
  });
  if (!user?.isActive) return false;

  const login = String(user.login || "").trim().toLowerCase();
  const fn = String(user.function?.name || "").trim().toLowerCase();
  return login === "mykolay" || fn === DEVELOPER_FUNCTION_NAME;
}

export async function revokeEncashmentConfirmation(params: {
  year: number;
  month: number;
  altegioIds: number[];
}): Promise<{ revoked: number; errors: string[] }> {
  const companyId = resolveCompanyId();
  let revoked = 0;
  const errors: string[] = [];

  for (const altegioId of params.altegioIds) {
    const existing = await prisma.encashmentConfirmation.findUnique({
      where: { companyId_altegioId: { companyId, altegioId } },
    });

    if (!existing) {
      errors.push(`Altegio ID ${altegioId}: запис підтвердження не знайдено`);
      continue;
    }

    if (existing.reportYear !== params.year || existing.reportMonth !== params.month) {
      errors.push(`Altegio ID ${altegioId}: платіж з іншого періоду звіту`);
      continue;
    }

    if (existing.status !== "owner_confirmed" && existing.status !== "pending_owner") {
      errors.push(`Altegio ID ${altegioId}: скасувати можна лише підтверджені або очікуючі`);
      continue;
    }

    await prisma.encashmentConfirmation.delete({ where: { id: existing.id } });
    revoked += 1;
  }

  if (revoked > 0) {
    await recomputeEncashmentPeriodStatus(params.year, params.month);
  }

  return { revoked, errors };
}
