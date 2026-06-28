import { prisma } from "@/lib/prisma";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import { createIncomingAcquiringExpense } from "@/lib/altegio/finance-transactions-create";
import {
  accountDiffKop,
  bankActualKyivDay,
  bankCommissionKop,
  bankFullAmountKop,
  buildIncomingDayAlignment,
  formatKyivDayLabel,
  type BankDayItemRow,
} from "@/lib/bank/incoming-reconcile-matching";

export type IncomingReconcileAccountDetail = {
  accountTitle: string;
  altegioTotalKop: string;
  bankFullTotalKop: string;
  bankItemIds: string[];
  acquiringExpensesCreated: number;
};

export type ReconcileIncomingDayResult = {
  kyivDay: string;
  dryRun: boolean;
  matchedAccounts: number;
  matchedBankItems: number;
  acquiringExpensesCreated: number;
  skippedAlreadyMatched: number;
  skippedDiffNonZero: number;
  skippedNoBank: number;
  details: IncomingReconcileAccountDetail[];
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
 * Збіг за рахунками та сумами (банк — повна/номінальна сума).
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
    skippedDiffNonZero: 0,
    skippedNoBank: 0,
    details: [],
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
    result.skippedNoBank = accountRows.filter((row) => row.altegioAccount).length;
    console.log("[incoming-payment-reconcile] Немає банківських платежів за день", kyivDay);
    return result;
  }

  const allBankIds = bankDay.rows.map((row) => row.id);
  const alreadyMatched = await loadExistingMatchedBankIds(allBankIds);
  const expenseDate = kyivDayToExpenseDate(kyivDay);
  const matchedAt = new Date();

  for (const accountRow of accountRows) {
    const { altegioAccount, bankGroup } = accountRow;
    if (!altegioAccount || !bankGroup) continue;

    const diff = accountDiffKop(altegioAccount, bankGroup);
    if (diff !== 0n) {
      result.skippedDiffNonZero += 1;
      console.log("[incoming-payment-reconcile] Пропуск — різниця сум", {
        kyivDay,
        account: altegioAccount.accountTitle,
        diff: diff.toString(),
        altegio: altegioAccount.totalKop,
        bankFull: bankGroup.rows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n).toString(),
      });
      continue;
    }

    const pendingBankRows = bankGroup.rows.filter((row) => !alreadyMatched.has(row.id));
    if (pendingBankRows.length === 0) {
      result.skippedAlreadyMatched += bankGroup.rows.length;
      continue;
    }

    if (pendingBankRows.length < bankGroup.rows.length) {
      result.skippedAlreadyMatched += bankGroup.rows.length - pendingBankRows.length;
      console.log("[incoming-payment-reconcile] Частково вже зведено — пропускаємо рахунок", {
        account: altegioAccount.accountTitle,
        kyivDay,
      });
      continue;
    }

    const detail: IncomingReconcileAccountDetail = {
      accountTitle: altegioAccount.accountTitle,
      altegioTotalKop: altegioAccount.totalKop,
      bankFullTotalKop: bankGroup.rows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n).toString(),
      bankItemIds: pendingBankRows.map((row) => row.id),
      acquiringExpensesCreated: 0,
    };

    if (!dryRun) {
      for (const bankRow of pendingBankRows) {
        let acquiringExpenseTransactionId: string | null = null;
        const commission = bankCommissionKop(bankRow);

        if (bankRow.kind === "universal_bank_aggregate" && commission > 0n) {
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

        await (prisma as any).bankAltegioIncomingMatch.create({
          data: {
            bankStatementItemId: bankRow.id,
            kyivDay,
            status: "auto_matched",
            matchType: commission > 0n ? "acquiring_fee" : "account_total",
            matchedAt,
            matchedBy,
            reviewNote: `Автозведення вхідних: ${altegioAccount.accountTitle}, ${kyivDay}`,
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

    console.log("[incoming-payment-reconcile] Зведено рахунок", {
      kyivDay,
      account: altegioAccount.accountTitle,
      bankItems: detail.bankItemIds.length,
      acquiring: detail.acquiringExpensesCreated,
      dryRun,
    });
  }

  console.log("[incoming-payment-reconcile] Завершено", result);
  return result;
}
