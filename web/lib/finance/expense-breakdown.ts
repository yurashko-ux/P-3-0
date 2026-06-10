import type { AltegioFinanceTransaction, ExpensesSummary } from "@/lib/altegio";

export type FinanceExpenseBreakdownItem = {
  key: string;
  label: string;
  amount: number;
  transactionCount: number;
  source: "master_id" | "comment" | "manual" | "unassigned";
};

function toMoneyNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function getTransactionSearchText(transaction: AltegioFinanceTransaction): string {
  return [
    transaction.expense?.title,
    transaction.expense?.name,
    transaction.expense?.category,
    transaction.comment,
    transaction.type,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isSalaryTransaction(transaction: AltegioFinanceTransaction): boolean {
  const text = getTransactionSearchText(transaction);
  return text.includes("зарплат") || text.includes("team salaries") || text.includes("salary") || text === "зп";
}

function isRentTransaction(transaction: AltegioFinanceTransaction): boolean {
  const text = getTransactionSearchText(transaction);
  return text.includes("оренд") || text.includes("rent");
}

function getStaffLabel(transaction: AltegioFinanceTransaction): {
  key: string;
  label: string;
  source: FinanceExpenseBreakdownItem["source"];
} {
  const rawStaffId =
    transaction.master_id ??
    (transaction as any).masterId ??
    (transaction as any).staff_id ??
    (transaction as any).staffId ??
    (transaction as any).master?.id ??
    (transaction as any).staff?.id;
  const staffId = Number(rawStaffId);

  if (Number.isFinite(staffId) && staffId > 0) {
    const staffName = normalizeText(
      (transaction as any).master?.name ??
        (transaction as any).staff?.name ??
        (transaction as any).master_name ??
        (transaction as any).staff_name,
    );
    return {
      key: `master:${staffId}`,
      label: staffName || `Працівник #${staffId}`,
      source: "master_id",
    };
  }

  const comment = normalizeText(transaction.comment);
  if (comment) {
    return {
      key: `comment:${comment.toLowerCase()}`,
      label: comment.length > 80 ? `${comment.slice(0, 77)}...` : comment,
      source: "comment",
    };
  }

  return {
    key: "unassigned",
    label: "Без прив'язки до працівника",
    source: "unassigned",
  };
}

function getRentLabel(transaction: AltegioFinanceTransaction): {
  key: string;
  label: string;
  source: FinanceExpenseBreakdownItem["source"];
} {
  const comment = normalizeText(transaction.comment);
  const expenseTitle = normalizeText(transaction.expense?.title || transaction.expense?.name || transaction.expense?.category);
  const accountTitle = normalizeText(transaction.account?.title || transaction.account?.name);
  const label = comment || expenseTitle || accountTitle || "Оренда";

  return {
    key: `rent:${label.toLowerCase()}`,
    label: label.length > 80 ? `${label.slice(0, 77)}...` : label,
    source: comment ? "comment" : "unassigned",
  };
}

function addToBreakdown(
  rows: Map<string, FinanceExpenseBreakdownItem>,
  group: { key: string; label: string; source: FinanceExpenseBreakdownItem["source"] },
  amount: number,
): void {
  const existing = rows.get(group.key);
  if (existing) {
    existing.amount = Math.round((existing.amount + amount) * 100) / 100;
    existing.transactionCount += 1;
    return;
  }

  rows.set(group.key, {
    key: group.key,
    label: group.label,
    amount: Math.round(amount * 100) / 100,
    transactionCount: 1,
    source: group.source,
  });
}

function finalizeBreakdown(
  rows: Map<string, FinanceExpenseBreakdownItem>,
  expectedTotal: number,
  unassignedLabel: string,
): FinanceExpenseBreakdownItem[] {
  const list = Array.from(rows.values())
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "uk"));

  const detailedTotal = Math.round(list.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const remainder = Math.round((expectedTotal - detailedTotal) * 100) / 100;
  if (remainder > 0.009) {
    list.push({
      key: "unassigned-total-diff",
      label: unassignedLabel,
      amount: remainder,
      transactionCount: 0,
      source: "unassigned",
    });
  }

  return list;
}

export function buildFinanceExpenseBreakdowns(
  expenses: ExpensesSummary | null | undefined,
  totals: { salary: number; rent: number; rentManual?: number },
): {
  salaryBreakdown: FinanceExpenseBreakdownItem[];
  rentBreakdown: FinanceExpenseBreakdownItem[];
} {
  const salaryRows = new Map<string, FinanceExpenseBreakdownItem>();
  const rentRows = new Map<string, FinanceExpenseBreakdownItem>();

  for (const transaction of expenses?.transactions || []) {
    const amount = Math.abs(toMoneyNumber(transaction.amount));
    if (amount <= 0) continue;

    if (isSalaryTransaction(transaction)) {
      addToBreakdown(salaryRows, getStaffLabel(transaction), amount);
      continue;
    }

    if (isRentTransaction(transaction)) {
      addToBreakdown(rentRows, getRentLabel(transaction), amount);
    }
  }

  const rentBreakdown = finalizeBreakdown(rentRows, totals.rent, "Оренда без деталізації");
  if (rentBreakdown.length === 0 && (totals.rentManual || 0) > 0) {
    rentBreakdown.push({
      key: "manual-rent",
      label: "Оренда (ручне поле)",
      amount: totals.rentManual || 0,
      transactionCount: 0,
      source: "manual",
    });
  }

  return {
    salaryBreakdown: finalizeBreakdown(salaryRows, totals.salary, "Без прив'язки до працівника"),
    rentBreakdown,
  };
}
