// Оборот і завдатки за kyiv-день з фінансів Altegio (як payment-reconciliation).
// Завдатки («Поповнення рахунку») — окремо; в оборот потрапляють лише коли
// списані в оплату візиту (звичайний платіж, не top-up).

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { fetchAltegioIncomeRowsForKyivDay } from "@/lib/bank/incoming-altegio-aggregate";

export type FinanceDayTotals = {
  kyivDay: string;
  /** Сума вхідних платежів без top-up завдатку, грн. */
  turnoverUah: number;
  /** Сума «Поповнення рахунку» за день, грн. */
  depositsUah: number;
  turnoverCount: number;
  depositCount: number;
  source: "db" | "live" | "mixed";
};

function kopToUah(kop: bigint): number {
  return Number(kop) / 100;
}

export async function getFinanceDayTotals(kyivDay: string): Promise<FinanceDayTotals> {
  const { rows, source } = await fetchAltegioIncomeRowsForKyivDay(kyivDay);

  let turnoverKop = 0n;
  let depositsKop = 0n;
  let turnoverCount = 0;
  let depositCount = 0;

  for (const row of rows) {
    if (row.amountKop <= 0n) continue;
    if (isDepositTopUpPaymentPurpose(row.paymentPurpose || "")) {
      depositsKop += row.amountKop;
      depositCount += 1;
      continue;
    }
    turnoverKop += row.amountKop;
    turnoverCount += 1;
  }

  const result: FinanceDayTotals = {
    kyivDay,
    turnoverUah: Math.round(kopToUah(turnoverKop) * 100) / 100,
    depositsUah: Math.round(kopToUah(depositsKop) * 100) / 100,
    turnoverCount,
    depositCount,
    source,
  };

  console.log("[reports/finance-day-totals] Підсумок дня", result);
  return result;
}
