// Автозведення завдатків (Поповнення рахунку) у розділі вхідних платежів.
// Зведення лише в межах одного календарного дня (Europe/Kyiv) — див. bankDayMatchesPaymentDay.

import { findNearestRecordAfterPayment } from "@/lib/altegio/deposit-attribution";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { fetchIncomingPaymentsWithDocumentNumbers } from "@/lib/altegio/incoming-payments";
import { getClientRecords } from "@/lib/altegio/records";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import {
  buildIncomingReconciliationPreview,
  type BankIncomingItem,
  type IncomingReconciliationPreview,
} from "@/lib/bank/incoming-altegio-aggregate";
import {
  accountsMatchForReconcile,
  bankDayMatchesPaymentDay,
  bankFullAmountKop,
  bankKyivDayFromOperationTime,
  bankCounterpartyLabel,
  isCashReconcileAccount,
  personNamesMatch,
} from "@/lib/bank/incoming-reconcile-matching";
import { deleteIncomingMatchesForBankRows, purgeIncompleteIncomingMatches } from "@/lib/bank/incoming-match-cleanup";
import { prisma } from "@/lib/prisma";

export type DepositIncomingMatchRecord = {
  id: string;
  altegioTransactionId: number;
  bankStatementItemId: string | null;
  paymentKyivDay: string;
  displayKyivDay: string;
  appointmentAt: string | null;
  clientId: number | null;
  payerName: string;
  amountKopiykas: string;
  accountTitle: string | null;
  operationTime: string | null;
  status: string;
  matchType: string;
  matchedAt: string;
  matchedBy: string | null;
  reviewNote: string | null;
};

export type SyncDepositIncomingMatchesResult = {
  scanned: number;
  upserted: number;
  withBank: number;
  withoutBank: number;
  withAppointment: number;
  paymentDayFallback: number;
  skippedAlreadyMatchedBank: number;
  skippedCashAccounts: number;
  purgedCashAutoMatches: number;
  purgedIncompleteIncoming: number;
  errors: string[];
};

type DepositCandidate = {
  altegioTransactionId: number;
  payerName: string;
  amountKop: bigint;
  accountTitle: string;
  operationTime: string;
  paymentKyivDay: string;
  paymentPurpose: string;
  clientId: number | null;
};

function resolveCompanyId(): number {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для автозведення завдатків");
  }
  return Number(companyId);
}

function kyivDayFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function flattenDepositCandidates(preview: IncomingReconciliationPreview): DepositCandidate[] {
  const candidates: DepositCandidate[] = [];

  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (isCashReconcileAccount(item.accountTitle)) continue;
      candidates.push({
        altegioTransactionId: item.altegioId,
        payerName: payer.payerName,
        amountKop: BigInt(item.amountKop),
        accountTitle: item.accountTitle,
        operationTime: item.operationTime,
        paymentKyivDay: bankKyivDayFromOperationTime(item.operationTime),
        paymentPurpose: item.paymentPurpose || "",
        clientId: null,
      });
    }
  }

  return candidates;
}

type BankNamedRowForDeposit = BankIncomingItem & {
  id: string;
  accountTitle: string;
  altegioAccountTitle: string | null;
};

function flattenBankNamedRows(preview: IncomingReconciliationPreview): BankNamedRowForDeposit[] {
  const rows: BankNamedRowForDeposit[] = [];
  for (const day of preview.bank.byDay) {
    for (const account of day.byAccount) {
      if (isCashReconcileAccount(account.accountTitle)) continue;
      if (account.altegioAccountTitle && isCashReconcileAccount(account.altegioAccountTitle)) continue;
      for (const item of account.items) {
        if (item.kind !== "named_incoming") continue;
        rows.push({
          ...item,
          accountTitle: account.accountTitle,
          altegioAccountTitle: account.altegioAccountTitle,
        });
      }
    }
  }
  return rows;
}

function findBankRowForDeposit(
  candidate: DepositCandidate,
  bankRows: BankNamedRowForDeposit[],
  usedBankIds: Set<string>,
  blockedBankIds: Set<string>,
): BankNamedRowForDeposit | null {
  for (const row of bankRows) {
    if (usedBankIds.has(row.id) || blockedBankIds.has(row.id)) continue;
    if (isCashReconcileAccount(row.accountTitle)) continue;
    if (row.altegioAccountTitle && isCashReconcileAccount(row.altegioAccountTitle)) continue;
    if (!bankDayMatchesPaymentDay(row.time, candidate.paymentKyivDay)) continue;
    if (!personNamesMatch(candidate.payerName, bankCounterpartyLabel(row))) continue;
    if (bankFullAmountKop(row) !== candidate.amountKop) continue;
    if (!accountsMatchForReconcile(candidate.accountTitle, row.accountTitle, row.altegioAccountTitle ?? null)) {
      continue;
    }
    return row;
  }
  return null;
}

function findBlockedBankRowsForDeposit(
  candidate: DepositCandidate,
  bankRows: BankNamedRowForDeposit[],
  usedBankIds: Set<string>,
  blockedBankIds: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const row of bankRows) {
    if (usedBankIds.has(row.id) || !blockedBankIds.has(row.id)) continue;
    if (isCashReconcileAccount(row.accountTitle)) continue;
    if (row.altegioAccountTitle && isCashReconcileAccount(row.altegioAccountTitle)) continue;
    if (!bankDayMatchesPaymentDay(row.time, candidate.paymentKyivDay)) continue;
    if (!personNamesMatch(candidate.payerName, bankCounterpartyLabel(row))) continue;
    if (bankFullAmountKop(row) !== candidate.amountKop) continue;
    if (!accountsMatchForReconcile(candidate.accountTitle, row.accountTitle, row.altegioAccountTitle ?? null)) {
      continue;
    }
    ids.push(row.id);
  }
  return ids;
}

function serializeDepositMatch(row: {
  id: string;
  altegioTransactionId: number;
  bankStatementItemId: string | null;
  paymentKyivDay: string;
  displayKyivDay: string;
  appointmentAt: Date | null;
  clientId: number | null;
  payerName: string;
  amountKopiykas: bigint;
  accountTitle: string | null;
  operationTime: string | null;
  status: string;
  matchType: string;
  matchedAt: Date;
  matchedBy: string | null;
  reviewNote: string | null;
}): DepositIncomingMatchRecord {
  return {
    id: row.id,
    altegioTransactionId: row.altegioTransactionId,
    bankStatementItemId: row.bankStatementItemId,
    paymentKyivDay: row.paymentKyivDay,
    displayKyivDay: row.displayKyivDay,
    appointmentAt: row.appointmentAt?.toISOString() ?? null,
    clientId: row.clientId,
    payerName: row.payerName,
    amountKopiykas: row.amountKopiykas.toString(),
    accountTitle: row.accountTitle,
    operationTime: row.operationTime,
    status: row.status,
    matchType: row.matchType,
    matchedAt: row.matchedAt.toISOString(),
    matchedBy: row.matchedBy,
    reviewNote: row.reviewNote,
  };
}

export async function loadDepositIncomingMatches(): Promise<DepositIncomingMatchRecord[]> {
  const rows = await prisma.bankAltegioDepositMatch.findMany({
    orderBy: [{ displayKyivDay: "desc" }, { matchedAt: "desc" }],
  });
  return rows.map(serializeDepositMatch);
}

function collectCashDepositAltegioIds(preview: IncomingReconciliationPreview): number[] {
  const ids: number[] = [];
  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (!isCashReconcileAccount(item.accountTitle)) continue;
      ids.push(item.altegioId);
    }
  }
  return ids;
}

/** Прибирає автозведення завдатків на готівкових рахунках Altegio. */
async function purgeAutoDepositMatchesForCashAltegio(
  cashAltegioIds: number[],
  dryRun: boolean,
): Promise<number> {
  if (cashAltegioIds.length === 0) return 0;
  if (dryRun) return cashAltegioIds.length;

  const deleted = await prisma.bankAltegioDepositMatch.deleteMany({
    where: {
      altegioTransactionId: { in: cashAltegioIds },
      matchedBy: "auto_deposit_reconcile",
    },
  });
  return deleted.count;
}

/**
 * Ідемпотентне автозведення завдатків: upsert у BankAltegioDepositMatch.
 */
export async function syncDepositIncomingMatches(
  options: { dryRun?: boolean; matchedBy?: string | null; preview?: IncomingReconciliationPreview } = {},
): Promise<SyncDepositIncomingMatchesResult> {
  const dryRun = options.dryRun === true;
  const matchedBy = options.matchedBy?.trim() || "auto_deposit_reconcile";
  const preview = options.preview ?? await buildIncomingReconciliationPreview();
  const companyId = resolveCompanyId();

  const result: SyncDepositIncomingMatchesResult = {
    scanned: 0,
    upserted: 0,
    withBank: 0,
    withoutBank: 0,
    withAppointment: 0,
    paymentDayFallback: 0,
    skippedAlreadyMatchedBank: 0,
    skippedCashAccounts: 0,
    purgedCashAutoMatches: 0,
    purgedIncompleteIncoming: 0,
    errors: [],
  };

  const incompleteCleanup = await purgeIncompleteIncomingMatches(preview, { dryRun });
  result.purgedIncompleteIncoming = incompleteCleanup.purged;
  if (incompleteCleanup.purged > 0) {
    console.log("[deposit-incoming-reconcile] Очищено неповні incoming-збіги перед автозведенням завдатків", {
      purged: incompleteCleanup.purged,
      dryRun,
    });
  }

  const cashDepositAltegioIds = collectCashDepositAltegioIds(preview);
  result.skippedCashAccounts = cashDepositAltegioIds.length;
  result.purgedCashAutoMatches = await purgeAutoDepositMatchesForCashAltegio(
    cashDepositAltegioIds,
    dryRun,
  );
  if (cashDepositAltegioIds.length > 0) {
    console.log("[deposit-incoming-reconcile] Пропущено готівкові рахунки", {
      skippedCashAccounts: cashDepositAltegioIds.length,
      purgedCashAutoMatches: result.purgedCashAutoMatches,
      dryRun,
    });
  }

  const candidates = flattenDepositCandidates(preview);
  result.scanned = candidates.length;
  if (candidates.length === 0) {
    console.log("[deposit-incoming-reconcile] Завдатків для зведення не знайдено (без готівкових рахунків)");
    return result;
  }

  const clientIdByTransactionId = new Map<number, number>();
  try {
    const payments = await fetchIncomingPaymentsWithDocumentNumbers({
      dateFrom: preview.dateFrom,
      dateTo: preview.dateTo,
      companyId: String(companyId),
      includeCashboxAccounts: true,
    });
    for (const payment of payments) {
      if (payment.clientId) {
        clientIdByTransactionId.set(payment.transactionId, payment.clientId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`clientId lookup: ${message}`);
    console.warn("[deposit-incoming-reconcile] Не вдалося отримати clientId:", error);
  }

  for (const candidate of candidates) {
    candidate.clientId = clientIdByTransactionId.get(candidate.altegioTransactionId) ?? null;
  }

  const [existingIncomingBankIds, existingDepositBankIds] = await Promise.all([
    prisma.bankAltegioIncomingMatch.findMany({ select: { bankStatementItemId: true } }),
    prisma.bankAltegioDepositMatch.findMany({ select: { bankStatementItemId: true } }),
  ]);

  const blockedBankIds = new Set(
    existingIncomingBankIds.map((row) => row.bankStatementItemId),
  );
  const usedBankIds = new Set(
    existingDepositBankIds
      .map((row) => row.bankStatementItemId)
      .filter((id): id is string => Boolean(id)),
  );

  const recordsCache = new Map<number, Awaited<ReturnType<typeof getClientRecords>>>();
  const uniqueClientIds = [
    ...new Set(candidates.map((c) => c.clientId).filter((id): id is number => id != null)),
  ];

  const batchSize = 5;
  const delayMs = 200;
  for (let index = 0; index < uniqueClientIds.length; index += batchSize) {
    const batch = uniqueClientIds.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (clientId) => {
        try {
          recordsCache.set(clientId, await getClientRecords(companyId, clientId));
        } catch (error) {
          console.warn(
            `[deposit-incoming-reconcile] getClientRecords clientId=${clientId}:`,
            error instanceof Error ? error.message : String(error),
          );
          recordsCache.set(clientId, []);
        }
      }),
    );
    if (index + batchSize < uniqueClientIds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const bankRows = flattenBankNamedRows(preview);
  const matchedAt = new Date();

  for (const candidate of candidates) {
    try {
      const paymentDate = new Date(candidate.operationTime);
      const records = candidate.clientId != null ? recordsCache.get(candidate.clientId) ?? [] : [];
      const appointmentDate = Number.isNaN(paymentDate.getTime())
        ? null
        : findNearestRecordAfterPayment(records, paymentDate);

      let displayKyivDay = candidate.paymentKyivDay;
      let appointmentAt: Date | null = null;
      if (appointmentDate) {
        displayKyivDay = kyivDayFromDate(appointmentDate);
        appointmentAt = appointmentDate;
        result.withAppointment += 1;
      } else {
        result.paymentDayFallback += 1;
      }

      let bankRow = findBankRowForDeposit(candidate, bankRows, usedBankIds, blockedBankIds);
      if (!bankRow && !dryRun) {
        const blockedIds = findBlockedBankRowsForDeposit(
          candidate,
          bankRows,
          usedBankIds,
          blockedBankIds,
        );
        if (blockedIds.length > 0) {
          const removedIncoming = await deleteIncomingMatchesForBankRows(blockedIds);
          for (const id of blockedIds) blockedBankIds.delete(id);
          if (removedIncoming > 0) {
            console.log("[deposit-incoming-reconcile] Звільнено банк завдатку від incoming-збігу", {
              altegioTransactionId: candidate.altegioTransactionId,
              bankStatementItemIds: blockedIds,
              removedIncoming,
            });
            bankRow = findBankRowForDeposit(candidate, bankRows, usedBankIds, blockedBankIds);
          }
        }
      }
      if (bankRow) {
        usedBankIds.add(bankRow.id);
        result.withBank += 1;
        if (!dryRun) {
          const removedIncoming = await deleteIncomingMatchesForBankRows([bankRow.id]);
          if (removedIncoming > 0) {
            console.log("[deposit-incoming-reconcile] Прибрано incoming-збіг для банку завдатку", {
              bankStatementItemId: bankRow.id,
              altegioTransactionId: candidate.altegioTransactionId,
              removedIncoming,
            });
          }
        }
      } else if (
        bankRows.some(
          (row) =>
            !usedBankIds.has(row.id)
            && bankDayMatchesPaymentDay(row.time, candidate.paymentKyivDay)
            && personNamesMatch(candidate.payerName, bankCounterpartyLabel(row))
            && bankFullAmountKop(row) === candidate.amountKop
            && blockedBankIds.has(row.id),
        )
      ) {
        result.skippedAlreadyMatchedBank += 1;
      } else {
        result.withoutBank += 1;
      }

      const reviewNote = appointmentDate
        ? `Завдаток: запис ${appointmentDate.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`
        : "Завдаток: без майбутнього запису (дата платежу)";

      if (dryRun) {
        result.upserted += 1;
        continue;
      }

      await prisma.bankAltegioDepositMatch.upsert({
        where: { altegioTransactionId: candidate.altegioTransactionId },
        create: {
          altegioTransactionId: candidate.altegioTransactionId,
          bankStatementItemId: bankRow?.id ?? null,
          paymentKyivDay: candidate.paymentKyivDay,
          displayKyivDay,
          appointmentAt,
          clientId: candidate.clientId,
          payerName: candidate.payerName,
          amountKopiykas: candidate.amountKop,
          accountTitle: candidate.accountTitle,
          operationTime: candidate.operationTime,
          status: "auto_matched",
          matchType: "deposit",
          matchedAt,
          matchedBy,
          reviewNote,
        },
        update: {
          bankStatementItemId: bankRow?.id ?? null,
          paymentKyivDay: candidate.paymentKyivDay,
          displayKyivDay,
          appointmentAt,
          clientId: candidate.clientId,
          payerName: candidate.payerName,
          amountKopiykas: candidate.amountKop,
          accountTitle: candidate.accountTitle,
          operationTime: candidate.operationTime,
          matchedAt,
          matchedBy,
          reviewNote,
        },
      });
      result.upserted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`altegioId=${candidate.altegioTransactionId}: ${message}`);
      console.error("[deposit-incoming-reconcile] Помилка зведення завдатку:", {
        altegioTransactionId: candidate.altegioTransactionId,
        error: message,
      });
    }
  }

  console.log("[deposit-incoming-reconcile] Автозведення завдатків завершено", result);
  return result;
}
