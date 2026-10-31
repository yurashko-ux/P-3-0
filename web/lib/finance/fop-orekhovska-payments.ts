// Платежі з ФОП Ореховська у формулі інкасації фінзвіту.
// З 01.10.2026 статтю прибрано і суму більше не додаємо до інкасації.

export const FOP_OREKHOVSKA_ENCASHMENT_CUTOFF = { year: 2026, month: 10 } as const;

export function shouldIncludeFopOrekhovskaInEncashment(year: number, month: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
  if (year < FOP_OREKHOVSKA_ENCASHMENT_CUTOFF.year) return true;
  if (year > FOP_OREKHOVSKA_ENCASHMENT_CUTOFF.year) return false;
  return month < FOP_OREKHOVSKA_ENCASHMENT_CUTOFF.month;
}

export function isFopOrekhovskaTransaction(transaction: {
  account?: { title?: string | null; name?: string | null } | null;
  comment?: string | null;
  expense?: { title?: string | null; name?: string | null } | null;
}): boolean {
  const accountTitle = (transaction.account?.title || "").toLowerCase();
  const accountName = (transaction.account?.name || "").toLowerCase();
  const comment = (transaction.comment || "").toLowerCase();
  const expenseTitle = (transaction.expense?.title || transaction.expense?.name || "").toLowerCase();

  if (
    accountTitle.includes("фоп ореховська") ||
    accountTitle.includes("фоп ореховская") ||
    accountTitle.includes("ореховська") ||
    accountTitle.includes("ореховская")
  ) {
    return true;
  }

  const searchText = `${accountName} ${comment} ${expenseTitle}`;
  return (
    searchText.includes("ореховська") ||
    searchText.includes("ореховская") ||
    searchText.includes("фоп ореховська") ||
    searchText.includes("фоп ореховская")
  );
}

export function sumFopOrekhovskaPayments(
  expenses: { transactions?: Array<Parameters<typeof isFopOrekhovskaTransaction>[0] & { amount?: number | string | null }> } | null | undefined,
  year: number,
  month: number,
): number {
  if (!shouldIncludeFopOrekhovskaInEncashment(year, month)) return 0;
  if (!expenses?.transactions || !Array.isArray(expenses.transactions)) return 0;

  return expenses.transactions
    .filter((t) => isFopOrekhovskaTransaction(t))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
}
