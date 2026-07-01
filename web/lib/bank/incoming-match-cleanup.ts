// Видалення неповних incoming-збігів, що блокують автозведення завдатків.

import type { IncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  bankCounterpartyLabel,
  filterAltegioDaysNonCash,
  findAltegioAccountOnDay,
  findAltegioClientForIncomingLink,
  groupAltegioPayersByDay,
  regroupBankByDayWithAcquiringShift,
  type BankDayItemRow,
} from "@/lib/bank/incoming-reconcile-matching";
import { prisma } from "@/lib/prisma";

export type PurgeIncompleteIncomingMatchesResult = {
  purged: number;
};

/**
 * Прибирає BankAltegioIncomingMatch без реальної пари Altegio (ім'я + сума / рахунок).
 * Такі записи блокують автозведення завдатків і не показуються в «Зведених».
 */
export async function purgeIncompleteIncomingMatches(
  preview: IncomingReconciliationPreview,
  options: { dryRun?: boolean } = {},
): Promise<PurgeIncompleteIncomingMatchesResult> {
  const dryRun = options.dryRun === true;
  const altegioDays = filterAltegioDaysNonCash(groupAltegioPayersByDay(preview.altegio.byPayer));
  const bankDays = regroupBankByDayWithAcquiringShift(preview.bank.byDay);
  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) bankRowById.set(row.id, row);
  }

  const matches = await (prisma as any).bankAltegioIncomingMatch.findMany({
    select: {
      id: true,
      bankStatementItemId: true,
      kyivDay: true,
      matchType: true,
      reviewNote: true,
    },
  });

  const deleteIds: string[] = [];

  for (const match of matches) {
    const bankRow = bankRowById.get(match.bankStatementItemId);
    if (!bankRow) continue;

    const isAcquiring =
      match.matchType === "acquiring_batch"
      || bankRow.kind === "universal_bank_aggregate";

    if (isAcquiring) {
      const altegioAccount = findAltegioAccountOnDay(
        altegioDays,
        match.kyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      if (!altegioAccount) deleteIds.push(match.id);
      continue;
    }

    let payerHint = bankCounterpartyLabel(bankRow);
    const note = match.reviewNote?.trim() || "";
    const fromNote = note.match(/^([^—–]+?)(?:\s*[—–-]\s*|\s+\d)/u);
    if (fromNote?.[1]?.trim()) payerHint = fromNote[1].trim();

    const found = findAltegioClientForIncomingLink(
      altegioDays,
      match.kyivDay,
      payerHint,
      bankRow.amountKop,
    );
    if (!found) deleteIds.push(match.id);
  }

  if (deleteIds.length === 0) {
    return { purged: 0 };
  }

  if (dryRun) {
    console.log("[incoming-match-cleanup] dryRun: неповні incoming-збіги", { count: deleteIds.length });
    return { purged: deleteIds.length };
  }

  const deleted = await (prisma as any).bankAltegioIncomingMatch.deleteMany({
    where: { id: { in: deleteIds } },
  });

  console.log("[incoming-match-cleanup] Видалено неповні incoming-збіги", {
    count: deleted.count,
    ids: deleteIds,
  });

  return { purged: deleted.count };
}
