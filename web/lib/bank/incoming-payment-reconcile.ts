import { prisma } from "@/lib/prisma";
import {
  buildIncomingReconciliationPreview,
  type IncomingReconciliationPreview,
} from "@/lib/bank/incoming-altegio-aggregate";
import { findAutomaticAcquiringExpenseTransactionId } from "@/lib/bank/automatic-altegio-payments";
import {
  bankRowsReconcileFullTotalKop,
  buildIncomingDayAlignment,
  evaluateIncomingAccountReconcile,
  filterAltegioDaysNonCash,
  groupAltegioPayersByDay,
  isIncomingRowAcquiringForReconcile,
  regroupBankByDayWithAcquiringShift,
} from "@/lib/bank/incoming-reconcile-matching";
import {
  bankOperationKyivDay,
  ensureIncomingReconciliationNumber,
  isIncomingReconcileMarkByBankTime,
} from "@/lib/bank/reconciliation-number";

export type IncomingReconcileAccountDetail = {
  accountTitle: string;
  bankItemIds: string[];
  namedMatchCount: number;
  acquiringMatched: boolean;
  altegioMatchedKop: string;
  bankMatchedKop: string;
  acquiringExpensesCreated: number;
  namedMatches: Array<{ payerName: string; amountKop: string; bankRowId: string }>;
};

export type IncomingReconcileUnmatchedDetail = {
  accountTitle: string;
  unmatchedBankKop: string;
  unmatchedAltegioKop: string;
  unmatchedBankItemIds: string[];
  unmatchedAltegioPayers: string[];
};

export type ReconcileIncomingDayResult = {
  kyivDay: string;
  dryRun: boolean;
  matchedAccounts: number;
  matchedBankItems: number;
  acquiringExpensesCreated: number;
  skippedAlreadyMatched: number;
  details: IncomingReconcileAccountDetail[];
  unmatched: IncomingReconcileUnmatchedDetail[];
  errors: string[];
};

export type SyncIncomingPaymentsForPreviewResult = {
  days: number;
  matchedBankItems: number;
  skippedAlreadyMatched: number;
  dayResults: ReconcileIncomingDayResult[];
  errors: string[];
};

function formatMoneyUah(kop: bigint): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(kop) / 100);
}

async function loadExistingMatchedBankIds(bankItemIds: string[]): Promise<Set<string>> {
  if (bankItemIds.length === 0) return new Set();
  const rows = await (prisma as any).bankAltegioIncomingMatch.findMany({
    where: { bankStatementItemId: { in: bankItemIds } },
    select: { bankStatementItemId: true },
  });
  return new Set(rows.map((row: { bankStatementItemId: string }) => row.bankStatementItemId));
}

/**
 * Автозведення вхідних безготівкових платежів за один київський день.
 * Зводимо лише точні збіги: іменовані (рахунок+клієнт+сума), еквайринг (рахунок+сума решти Altegio).
 */
export async function reconcileIncomingPaymentsForKyivDay(
  kyivDay: string,
  options: {
    dryRun?: boolean;
    matchedBy?: string | null;
    preview?: IncomingReconciliationPreview;
  } = {},
): Promise<ReconcileIncomingDayResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kyivDay)) {
    throw new Error(`Некоректний формат дати зведення: ${kyivDay}`);
  }

  const dryRun = options.dryRun === true;
  const matchedBy = options.matchedBy?.trim() || "auto_incoming_reconcile";
  const result: ReconcileIncomingDayResult = {
    kyivDay,
    dryRun,
    matchedAccounts: 0,
    matchedBankItems: 0,
    acquiringExpensesCreated: 0,
    skippedAlreadyMatched: 0,
    details: [],
    unmatched: [],
    errors: [],
  };

  console.log("[incoming-payment-reconcile] Старт зведення", { kyivDay, dryRun, matchedBy });

  const preview = options.preview ?? await buildIncomingReconciliationPreview();
  const { altegioDay, bankDay, accountRows } = buildIncomingDayAlignment(
    preview.altegio.byPayer,
    preview.bank.byDay,
    kyivDay,
  );

  if (!altegioDay) {
    console.log("[incoming-payment-reconcile] Немає безготівкових платежів Altegio за день", kyivDay);
    return result;
  }

  if (!bankDay) {
    for (const accountRow of accountRows) {
      if (!accountRow.altegioAccount) continue;
      result.unmatched.push({
        accountTitle: accountRow.altegioAccount.accountTitle,
        unmatchedBankKop: "0",
        unmatchedAltegioKop: accountRow.altegioAccount.totalKop,
        unmatchedBankItemIds: [],
        unmatchedAltegioPayers: accountRow.altegioAccount.clients.map((client) => client.payerName),
      });
    }
    console.log("[incoming-payment-reconcile] Немає банківських платежів за день", kyivDay);
    return result;
  }

  const allBankIds = bankDay.rows.map((row) => row.id);
  const alreadyMatched = await loadExistingMatchedBankIds(allBankIds);
  const matchedAt = new Date();

  for (const accountRow of accountRows) {
    const { altegioAccount } = accountRow;
    if (!altegioAccount) continue;

    const evaluation = evaluateIncomingAccountReconcile(altegioAccount, bankDay, {
      excludeBankRowIds: alreadyMatched,
    });
    const pendingBankRows = evaluation.matchedBankRows.filter((row) => !alreadyMatched.has(row.id));
    const rowsToSave = pendingBankRows;
    const savedBankIds = new Set(rowsToSave.map((row) => row.id));

    if (
      evaluation.unmatchedBankRows.length > 0
      || evaluation.unmatchedAltegioKop > 0n
    ) {
      result.unmatched.push({
        accountTitle: altegioAccount.accountTitle,
        unmatchedBankKop: bankRowsReconcileFullTotalKop(evaluation.unmatchedBankRows).toString(),
        unmatchedAltegioKop: evaluation.unmatchedAltegioKop.toString(),
        unmatchedBankItemIds: evaluation.unmatchedBankRows.map((row) => row.id),
        unmatchedAltegioPayers: evaluation.unmatchedAltegioClients.map((client) => client.payerName),
      });
    }

    if (rowsToSave.length === 0) {
      if (evaluation.matchedBankRows.length > 0) {
        result.skippedAlreadyMatched += evaluation.matchedBankRows.length;
      }
      continue;
    }

    const savesBatchAcquiring = evaluation.acquiringBatchMatches.some((batch) =>
      batch.bankRowIds.some((bankRowId) => savedBankIds.has(bankRowId)),
    );
    const countedBatchKeys = new Set<string>();
    let batchAltegioMatchedKop = 0n;
    for (const batch of evaluation.acquiringBatchMatches) {
      if (!batch.bankRowIds.some((bankRowId) => savedBankIds.has(bankRowId))) continue;
      const batchKey = batch.bankRowIds.join("+");
      if (countedBatchKeys.has(batchKey)) continue;
      countedBatchKeys.add(batchKey);
      batchAltegioMatchedKop += BigInt(batch.altegioRemainingKop);
    }

    const altegioMatchedKop =
      evaluation.namedMatches
        .filter((match) => savedBankIds.has(match.bankRowId))
        .reduce((sum, match) => sum + BigInt(match.amountKop), 0n)
      + evaluation.acquiringClientMatches
        .filter((match) => savedBankIds.has(match.bankRowId))
        .reduce((sum, match) => sum + BigInt(match.amountKop), 0n)
      + batchAltegioMatchedKop;
    const bankMatchedKop = bankRowsReconcileFullTotalKop(rowsToSave);

    if (altegioMatchedKop !== bankMatchedKop) {
      console.warn("[incoming-payment-reconcile] Суми Altegio і банку не збігаються — пропускаємо", {
        kyivDay,
        account: altegioAccount.accountTitle,
        altegioMatchedKop: altegioMatchedKop.toString(),
        bankMatchedKop: bankMatchedKop.toString(),
      });
      continue;
    }

    const detail: IncomingReconcileAccountDetail = {
      accountTitle: altegioAccount.accountTitle,
      bankItemIds: rowsToSave.map((row) => row.id),
      namedMatchCount: evaluation.namedMatches.filter((match) =>
        rowsToSave.some((row) => row.id === match.bankRowId),
      ).length,
      acquiringMatched: savesBatchAcquiring || evaluation.acquiringClientMatches.some((match) =>
        rowsToSave.some((row) => row.id === match.bankRowId),
      ),
      altegioMatchedKop: altegioMatchedKop.toString(),
      bankMatchedKop: bankMatchedKop.toString(),
      acquiringExpensesCreated: 0,
      namedMatches: evaluation.namedMatches.filter((match) =>
        rowsToSave.some((row) => row.id === match.bankRowId),
      ),
    };

    if (!dryRun) {
      for (const bankRow of rowsToSave) {
        let acquiringExpenseTransactionId: string | null = null;
        const isAcquiring = isIncomingRowAcquiringForReconcile(bankRow);

        if (isAcquiring) {
          acquiringExpenseTransactionId = await findAutomaticAcquiringExpenseTransactionId(bankRow.id);
        }

        const namedMatch = evaluation.namedMatches.find((match) => match.bankRowId === bankRow.id);
        const acquiringClientMatch = evaluation.acquiringClientMatches.find(
          (match) => match.bankRowId === bankRow.id,
        );
        const batchMatch = evaluation.acquiringBatchMatches.find((batch) =>
          batch.bankRowIds.includes(bankRow.id),
        );
        const matchType = isAcquiring ? "acquiring_batch" : "named_client";
        const reviewNote = namedMatch
          ? `Іменований: ${namedMatch.payerName}, ${formatMoneyUah(BigInt(namedMatch.amountKop))} ₴`
          : acquiringClientMatch
            ? `За сумою: ${acquiringClientMatch.payerName}, ${formatMoneyUah(BigInt(acquiringClientMatch.amountKop))} ₴`
          : batchMatch
            ? `Еквайринг: номінал ${formatMoneyUah(BigInt(batchMatch.bankFullKop))} ₴ = Altegio ${formatMoneyUah(BigInt(batchMatch.altegioRemainingKop))} ₴`
            : `Автозведення: ${altegioAccount.accountTitle}, ${kyivDay}`;

        await (prisma as any).bankAltegioIncomingMatch.create({
          data: {
            bankStatementItemId: bankRow.id,
            kyivDay,
            status: "auto_matched",
            matchType,
            matchedAt,
            matchedBy,
            reviewNote,
            acquiringExpenseTransactionId,
          },
        });
        await ensureIncomingReconciliationNumber(bankRow.id);

        alreadyMatched.add(bankRow.id);
        result.matchedBankItems += 1;
      }
    } else {
      result.matchedBankItems += rowsToSave.length;
    }

    result.matchedAccounts += 1;
    result.details.push(detail);

    console.log("[incoming-payment-reconcile] Зведено збіги по рахунку", {
      kyivDay,
      account: altegioAccount.accountTitle,
      named: detail.namedMatchCount,
      acquiring: detail.acquiringMatched,
      bankItems: detail.bankItemIds.length,
      dryRun,
    });
  }

  console.log("[incoming-payment-reconcile] Завершено", result);
  return result;
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Зберегти в БД зведення для вхідних рядків банку, які вже «зведені» у live-оцінці UI,
 * але ще без BankAltegioIncomingMatch (типово еквайринг з групуванням на −1 день).
 */
export async function persistMissingIncomingMatchesForBankItems(
  items: Array<{
    id: string;
    time: Date;
    amount: bigint;
    description: string;
    comment: string | null;
    counterName: string | null;
  }>,
): Promise<{ attemptedDays: string[]; matchedBankItems: number }> {
  const candidates = items.filter(
    (item) => item.amount > 0n && isIncomingReconcileMarkByBankTime(item.time),
  );
  if (candidates.length === 0) {
    return { attemptedDays: [], matchedBankItems: 0 };
  }

  const candidateIds = candidates.map((item) => item.id);
  const [incomingRows, depositRows] = await Promise.all([
    (prisma as any).bankAltegioIncomingMatch.findMany({
      where: { bankStatementItemId: { in: candidateIds } },
      select: { bankStatementItemId: true },
    }),
    (prisma as any).bankAltegioDepositMatch.findMany({
      where: { bankStatementItemId: { in: candidateIds } },
      select: { bankStatementItemId: true },
    }),
  ]);
  const alreadyLinked = new Set<string>([
    ...incomingRows.map((row: { bankStatementItemId: string }) => row.bankStatementItemId),
    ...depositRows
      .map((row: { bankStatementItemId: string | null }) => row.bankStatementItemId)
      .filter((id: string | null): id is string => Boolean(id)),
  ]);

  const missing = candidates.filter((item) => !alreadyLinked.has(item.id));
  if (missing.length === 0) {
    return { attemptedDays: [], matchedBankItems: 0 };
  }

  const days = new Set<string>();
  for (const item of missing) {
    const bankDay = bankOperationKyivDay(item.time);
    if (!bankDay) continue;
    days.add(bankDay);
    const looksAcquiring = isIncomingRowAcquiringForReconcile({
      id: item.id,
      time: item.time.toISOString(),
      amountKop: item.amount.toString(),
      description: item.description,
      comment: item.comment,
      counterName: item.counterName,
      kind: "named_incoming",
      commissionKop: null,
      commissionRaw: null,
    });
    if (looksAcquiring) {
      days.add(addDaysYmd(bankDay, -1));
    }
  }

  const attemptedDays = [...days].sort();
  if (attemptedDays.length === 0) {
    return { attemptedDays: [], matchedBankItems: 0 };
  }

  console.log("[incoming-payment-reconcile] Persist зведень для Банку", {
    missingItems: missing.length,
    attemptedDays,
  });

  const preview = await buildIncomingReconciliationPreview();
  let matchedBankItems = 0;
  for (const kyivDay of attemptedDays) {
    const result = await reconcileIncomingPaymentsForKyivDay(kyivDay, {
      preview,
      matchedBy: "bank_operations_persist",
    });
    matchedBankItems += result.matchedBankItems;
  }

  return { attemptedDays, matchedBankItems };
}

/**
 * Автозведення вхідних за всі дні періоду preview (як deposit-sync при «Оновити»).
 */
export async function syncIncomingPaymentsForPreview(
  preview: IncomingReconciliationPreview,
  options: { dryRun?: boolean; matchedBy?: string | null } = {},
): Promise<SyncIncomingPaymentsForPreviewResult> {
  const altegioDays = filterAltegioDaysNonCash(groupAltegioPayersByDay(preview.altegio.byPayer));
  const bankDays = regroupBankByDayWithAcquiringShift(preview.bank.byDay);
  const kyivDays = new Set<string>();
  for (const day of altegioDays) kyivDays.add(day.kyivDay);
  for (const day of bankDays) kyivDays.add(day.kyivDay);

  const sortedDays = [...kyivDays].sort();
  const dayResults: ReconcileIncomingDayResult[] = [];
  const errors: string[] = [];
  let matchedBankItems = 0;
  let skippedAlreadyMatched = 0;

  console.log("[incoming-payment-reconcile] Старт автозведення за період", {
    dateFrom: preview.dateFrom,
    dateTo: preview.dateTo,
    days: sortedDays.length,
    dryRun: options.dryRun === true,
  });

  for (const kyivDay of sortedDays) {
    try {
      const result = await reconcileIncomingPaymentsForKyivDay(kyivDay, {
        ...options,
        preview,
      });
      dayResults.push(result);
      matchedBankItems += result.matchedBankItems;
      skippedAlreadyMatched += result.skippedAlreadyMatched;
      errors.push(...result.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${kyivDay}: ${message}`);
      console.error("[incoming-payment-reconcile] Помилка зведення за день", { kyivDay, error: message });
    }
  }

  const summary: SyncIncomingPaymentsForPreviewResult = {
    days: sortedDays.length,
    matchedBankItems,
    skippedAlreadyMatched,
    dayResults,
    errors,
  };

  console.log("[incoming-payment-reconcile] Автозведення за період завершено", summary);
  return summary;
}
