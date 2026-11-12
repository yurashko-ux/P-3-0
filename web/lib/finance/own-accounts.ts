// Каси й рахунки для оплати — з власного довідника Kresco (finance_accounts), без запиту в Altegio.

import { prisma } from "@/lib/prisma";

export type PaymentAccount = { id: number; title: string; type: string | null };

/**
 * Рахунки для чека й поповнення завдатку. id — номер рахунку Altegio: на перехідний період
 * ним досі позначені платежі чеків і дубль оплати в Altegio.
 */
export async function listPaymentAccounts(): Promise<PaymentAccount[]> {
  const rows = await prisma.financeAccount.findMany({
    where: { altegioAccountId: { not: null }, archivedAt: null },
    select: { altegioAccountId: true, title: true, kind: true, currencyCode: true },
  });
  // Порядок плиток: гривнева каса, банківські рахунки, валютні каси.
  const rank = (row: (typeof rows)[number]) =>
    row.kind === "cash" ? (row.currencyCode === "UAH" ? 0 : 2) : 1;
  return rows
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, "uk"))
    .map((row) => ({ id: Number(row.altegioAccountId), title: row.title, type: row.kind }));
}
