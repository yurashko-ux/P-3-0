// Готівкові завдатки для вкладки ЗАВДАТКИ (віртуальна пара з Каса/Долар/Євро).

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import {
  isCashAltegioAccount,
  isCashReconcileAccount,
} from "@/lib/bank/incoming-reconcile-matching";
import type { IncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import type { DepositSplitAccountRow, DepositSplitDay } from "@/lib/bank/deposit-realization";

function kyivDayFromOperationTime(operationTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(operationTime));
}

function formatKyivDayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  return `${day}.${month}.${year}`;
}

type CashDepositBankRow = {
  id: string;
  time: string;
  amountKop: string;
  description: string;
  comment: string | null;
  counterName: string | null;
  kind: "named_incoming";
  commissionKop: string | null;
  commissionRaw: string | null;
  accountTitle: string;
  altegioAccountTitle: string | null;
  isDepositCashPlaceholder: true;
};

/** Завдатки на готівкових рахунках Altegio — лише для вкладки ЗАВДАТКИ. */
export function buildCashDepositTabDays(
  preview: IncomingReconciliationPreview,
  skipAltegioIds: Set<number>,
): DepositSplitDay[] {
  const byDay = new Map<string, DepositSplitAccountRow[]>();

  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (!isCashAltegioAccount(item.accountTitle) && !isCashReconcileAccount(item.accountTitle)) {
        continue;
      }
      if (skipAltegioIds.has(item.altegioId)) continue;

      const kyivDay = kyivDayFromOperationTime(item.operationTime);
      const cashBankRow: CashDepositBankRow = {
        id: `cash-deposit|${item.altegioId}`,
        time: item.operationTime,
        amountKop: item.amountKop,
        description: payer.payerName,
        comment: "Готівка (завдаток)",
        counterName: payer.payerName,
        kind: "named_incoming",
        commissionKop: null,
        commissionRaw: null,
        accountTitle: item.accountTitle,
        altegioAccountTitle: item.accountTitle,
        isDepositCashPlaceholder: true,
      };

      const accountRow: DepositSplitAccountRow = {
        matchKey: `cash-deposit|${item.altegioId}`,
        isDepositMatch: true,
        altegioAccount: {
          accountTitle: item.accountTitle,
          totalKop: item.amountKop,
          latestOperationTime: item.operationTime,
          clients: [{
            payerName: payer.payerName,
            totalKop: item.amountKop,
            latestOperationTime: item.operationTime,
            items: [{
              altegioId: item.altegioId,
              recordId: item.recordId,
              payerName: payer.payerName,
              amountKop: item.amountKop,
              accountTitle: item.accountTitle,
              operationTime: item.operationTime,
              paymentPurpose: item.paymentPurpose,
            }],
          }],
        },
        bankGroup: {
          accountTitle: item.accountTitle,
          altegioAccountTitle: item.accountTitle,
          rows: [cashBankRow],
        },
      };

      if (!byDay.has(kyivDay)) byDay.set(kyivDay, []);
      byDay.get(kyivDay)!.push(accountRow);
      skipAltegioIds.add(item.altegioId);
    }
  }

  return Array.from(byDay.entries())
    .map(([kyivDay, accountRows]) => ({
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      accountRows,
      altegio: null,
      bank: null,
    }))
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}
