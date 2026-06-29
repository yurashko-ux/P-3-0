import { prisma } from "@/lib/prisma";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import { createIncomingAcquiringExpense } from "@/lib/altegio/finance-transactions-create";
import {
  bankActualKyivDay,
  bankCommissionKop,
  bankRowsReconcileFullTotalKop,
  buildIncomingDayAlignment,
  evaluateIncomingAccountReconcile,
  formatKyivDayLabel,
  type BankDayItemRow,
} from "@/lib/bank/incoming-reconcile-matching";

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

function kyivDayToExpenseDate(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  return new Date(Date.UTC(year, month - 1, day, 12 - offsetHours, 0, 0, 0));
}

function formatMoneyUah(kop: bigint): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(kop) / 100);
}

function buildAcquiringComment(item: BankDayItemRow): string {
  const acquiringDate = formatKyivDayLabel(bankActualKyivDay(item));
  const factualAmount = formatMoneyUah(BigInt(item.amountKop || 0));
  return `${acquiringDate}, ${factualAmount} грн`;
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
  options: { dryRun?: boolean; matchedBy?: string | null } = {},
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

  const preview = await buildIncomingReconciliationPreview();
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
  const expenseDate = kyivDayToExpenseDate(kyivDay);
  const matchedAt = new Date();

  for (const accountRow of accountRows) {
    const { altegioAccount } = accountRow;
    if (!altegioAccount) continue;

    const evaluation = evaluateIncomingAccountReconcile(altegioAccount, bankDay);
    const pendingBankRows = evaluation.matchedBankRows.filter((row) => !alreadyMatched.has(row.id));

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

    if (pendingBankRows.length === 0) {
      if (evaluation.matchedBankRows.length > 0) {
        result.skippedAlreadyMatched += evaluation.matchedBankRows.length;
      }
      continue;
    }

    const altegioMatchedKop =
      evaluation.namedMatches.reduce((sum, match) => sum + BigInt(match.amountKop), 0n)
      + (evaluation.acquiringMatch ? BigInt(evaluation.acquiringMatch.altegioRemainingKop) : 0n);
    const bankMatchedKop = bankRowsReconcileFullTotalKop(pendingBankRows);

    const detail: IncomingReconcileAccountDetail = {
      accountTitle: altegioAccount.accountTitle,
      bankItemIds: pendingBankRows.map((row) => row.id),
      namedMatchCount: evaluation.namedMatches.filter((match) =>
        pendingBankRows.some((row) => row.id === match.bankRowId),
      ).length,
      acquiringMatched: Boolean(
        evaluation.acquiringMatch
        && evaluation.acquiringMatch.bankRowIds.some((id) =>
          pendingBankRows.some((row) => row.id === id),
        ),
      ),
      altegioMatchedKop: altegioMatchedKop.toString(),
      bankMatchedKop: bankMatchedKop.toString(),
      acquiringExpensesCreated: 0,
      namedMatches: evaluation.namedMatches.filter((match) =>
        pendingBankRows.some((row) => row.id === match.bankRowId),
      ),
    };

    if (!dryRun) {
      for (const bankRow of pendingBankRows) {
        let acquiringExpenseTransactionId: string | null = null;
        const commission = bankCommissionKop(bankRow);
        const isAcquiring = bankRow.kind === "universal_bank_aggregate";

        if (isAcquiring && commission > 0n) {
          try {
            const expense = await createIncomingAcquiringExpense({
              bankStatementItemId: bankRow.id,
              commissionKopiykas: commission,
              comment: buildAcquiringComment(bankRow),
              expenseDate,
              matchedBy,
            });
            acquiringExpenseTransactionId = expense.transaction.id;
            detail.acquiringExpensesCreated += 1;
            result.acquiringExpensesCreated += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push(
              `Еквайрінг ${bankRow.id} (${altegioAccount.accountTitle}): ${message}`,
            );
            console.error("[incoming-payment-reconcile] Помилка створення еквайрингу", {
              bankItemId: bankRow.id,
              error: message,
            });
            continue;
          }
        }

        const namedMatch = evaluation.namedMatches.find((match) => match.bankRowId === bankRow.id);
        const matchType = isAcquiring ? "acquiring_batch" : "named_client";
        const reviewNote = namedMatch
          ? `Іменований: ${namedMatch.payerName}, ${formatMoneyUah(BigInt(namedMatch.amountKop))} ₴`
          : evaluation.acquiringMatch
            ? `Еквайринг: номінал ${formatMoneyUah(BigInt(evaluation.acquiringMatch.bankFullKop))} ₴ = Altegio ${formatMoneyUah(BigInt(evaluation.acquiringMatch.altegioRemainingKop))} ₴`
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

        alreadyMatched.add(bankRow.id);
        result.matchedBankItems += 1;
      }
    } else {
      for (const bankRow of pendingBankRows) {
        if (bankRow.kind === "universal_bank_aggregate" && bankCommissionKop(bankRow) > 0n) {
          detail.acquiringExpensesCreated += 1;
          result.acquiringExpensesCreated += 1;
        }
      }
      result.matchedBankItems += pendingBankRows.length;
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
