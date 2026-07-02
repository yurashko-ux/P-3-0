// Видалення неповних incoming-збігів, що блокують автозведення завдатків.

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import type { IncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  accountsMatchForReconcile,
  bankCounterpartyLabel,
  bankFullAmountKop,
  filterAltegioDaysNonCash,
  findAltegioAccountOnDay,
  findAltegioClientForIncomingLink,
  evaluateIncomingAccountReconcile,
  groupAltegioPayersByDay,
  isIncomingRowAcquiringForReconcile,
  personNamesMatch,
  regroupBankByDayWithAcquiringShift,
  type AltegioDayAccountClient,
  type BankDayItemRow,
} from "@/lib/bank/incoming-reconcile-matching";
import { prisma } from "@/lib/prisma";

export type PurgeIncompleteIncomingMatchesResult = {
  purged: number;
};

function clientIsDepositOnly(client: AltegioDayAccountClient): boolean {
  return (
    client.items.length > 0
    && client.items.every((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || ""))
  );
}

/** Чи відповідає банківський рядок завдатку в Altegio (ім'я + сума + рахунок). */
function bankRowMatchesDepositCandidate(
  bankRow: BankDayItemRow,
  payerHint: string,
  preview: IncomingReconciliationPreview,
): boolean {
  const bankAmount = BigInt(bankRow.amountKop || 0);
  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (BigInt(item.amountKop) !== bankAmount) continue;
      if (!personNamesMatch(payer.payerName, payerHint)) continue;
      if (!accountsMatchForReconcile(
        item.accountTitle,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      )) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Прибирає BankAltegioIncomingMatch без реальної пари Altegio (ім'я + сума / рахунок),
 * а також incoming-збіги на завдатки — їх зводить deposit-match.
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

    const isAcquiring = isIncomingRowAcquiringForReconcile(bankRow);

    if (isAcquiring) {
      const bankDay = bankDays.find((day) => day.kyivDay === match.kyivDay);
      const altegioAccount = findAltegioAccountOnDay(
        altegioDays,
        match.kyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      if (!altegioAccount || !bankDay) {
        deleteIds.push(match.id);
        continue;
      }
      const evaluation = evaluateIncomingAccountReconcile(altegioAccount, bankDay);
      const inBatch = evaluation.acquiringBatchMatches.some((batch) =>
        batch.bankRowIds.includes(match.bankStatementItemId),
      );
      const inIndividual = evaluation.acquiringClientMatches.some(
        (item) => item.bankRowId === match.bankStatementItemId,
      );
      if (!inBatch && !inIndividual) {
        deleteIds.push(match.id);
      }
      continue;
    }

    let payerHint = bankCounterpartyLabel(bankRow);
    const note = match.reviewNote?.trim() || "";
    const fromNote = note.match(/^([^—–]+?)(?:\s*[—–-]\s*|\s+\d)/u);
    if (fromNote?.[1]?.trim()) payerHint = fromNote[1].trim();

    if (bankRowMatchesDepositCandidate(bankRow, payerHint, preview)) {
      deleteIds.push(match.id);
      continue;
    }

    const found = findAltegioClientForIncomingLink(
      altegioDays,
      match.kyivDay,
      payerHint,
      bankFullAmountKop(bankRow).toString(),
    );
    if (!found) {
      deleteIds.push(match.id);
      continue;
    }

    if (clientIsDepositOnly(found.client)) {
      deleteIds.push(match.id);
    }
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

/** Виправляє помилковий matchType=named_client для еквайрингових рядків у БД. */
export async function repairIncomingAcquiringMatchTypes(
  preview: IncomingReconciliationPreview,
): Promise<{ repaired: number }> {
  const bankDays = regroupBankByDayWithAcquiringShift(preview.bank.byDay);
  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) bankRowById.set(row.id, row);
  }

  const matches = await (prisma as any).bankAltegioIncomingMatch.findMany({
    where: { matchType: { not: "acquiring_batch" } },
    select: { id: true, bankStatementItemId: true, matchType: true },
  });

  const repairIds: string[] = [];
  for (const match of matches) {
    const bankRow = bankRowById.get(match.bankStatementItemId);
    if (!bankRow) continue;
    if (!isIncomingRowAcquiringForReconcile(bankRow)) continue;
    repairIds.push(match.id);
  }

  if (repairIds.length === 0) return { repaired: 0 };

  const updated = await (prisma as any).bankAltegioIncomingMatch.updateMany({
    where: { id: { in: repairIds } },
    data: { matchType: "acquiring_batch" },
  });

  console.log("[incoming-match-cleanup] Виправлено matchType для еквайрингу", {
    count: updated.count,
    ids: repairIds,
  });

  return { repaired: updated.count };
}

/** Прибирає incoming-збіг для банківського рядка, якщо його зайняв deposit-match. */
export async function deleteIncomingMatchesForBankRows(
  bankStatementItemIds: string[],
): Promise<number> {
  if (bankStatementItemIds.length === 0) return 0;
  const deleted = await (prisma as any).bankAltegioIncomingMatch.deleteMany({
    where: { bankStatementItemId: { in: bankStatementItemIds } },
  });
  return deleted.count;
}
