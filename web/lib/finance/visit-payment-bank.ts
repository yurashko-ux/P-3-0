// Зв’язок оплати візиту з банківським платежем.
// Готівку з monobank не зводимо. Розпроводка зведених — пізніше, лише для розробника.

import { prisma } from "@/lib/prisma";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { formatBankPaymentNumber } from "@/lib/bank/payment-number";
import { buildBankStatementItemUrl } from "@/lib/bank/web-urls";

const LINKED = new Set(["auto_matched", "manual_matched"]);

export type VisitPaymentBankRef = {
  bankStatementItemId: string;
  paymentNumber: number;
  label: string;
  href: string;
};

type PaymentRef = {
  id: string;
  altegioTransactionId: number | null;
  accountId: number;
  accountTitle: string | null;
  amount: number;
  kyivDay: string;
  client: string;
  paymentKind: string;
};

function surname(client: string): string {
  const word = client.trim().split(/\s+/)[0] || "";
  return word.length >= 3 ? word.toLowerCase() : "";
}

function absKop(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function kopDistance(bankAmount: bigint, paymentUah: number): bigint {
  const paymentKop = BigInt(Math.round(paymentUah * 100));
  const left = absKop(bankAmount);
  const right = absKop(paymentKop);
  return left > right ? left - right : right - left;
}

function kyivShort(time: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(time);
}

function toRef(item: { id: string; time: Date; paymentNumber: number }): VisitPaymentBankRef {
  return {
    bankStatementItemId: item.id,
    paymentNumber: item.paymentNumber,
    label: `${kyivShort(item.time)}, № ${formatBankPaymentNumber(item.paymentNumber)}`,
    href: buildBankStatementItemUrl(item.id, item.time.toISOString()),
  };
}

export async function bankLinksForVisitPayments(rows: PaymentRef[]): Promise<Map<string, VisitPaymentBankRef>> {
  const links = new Map<string, VisitPaymentBankRef>();
  const open = rows.filter(
    (row) => row.paymentKind !== "deposit" && !isCashAltegioAccount(row.accountTitle || ""),
  );
  if (open.length === 0) return links;

  const txIds = [
    ...new Set(
      open
        .map((row) => row.altegioTransactionId)
        .filter((id): id is number => id != null && id > 0),
    ),
  ];
  if (txIds.length > 0) {
    const transactions = await prisma.altegioFinanceTransaction.findMany({
      where: { altegioId: { in: txIds } },
      select: {
        altegioId: true,
        bankPaymentMatch: {
          select: {
            status: true,
            bankStatementItem: { select: { id: true, time: true, paymentNumber: true } },
          },
        },
      },
    });
    const byAltegio = new Map(transactions.map((row) => [row.altegioId, row.bankPaymentMatch]));
    for (const row of open) {
      const match = row.altegioTransactionId ? byAltegio.get(row.altegioTransactionId) : null;
      const item = match && LINKED.has(match.status) ? match.bankStatementItem : null;
      if (item) links.set(row.id, toRef(item));
    }
  }

  const rest = open.filter((row) => !links.has(row.id));
  if (rest.length === 0) return links;

  const days = [...new Set(rest.map((row) => row.kyivDay))];
  const matches = await prisma.bankAltegioIncomingMatch.findMany({
    where: { kyivDay: { in: days }, status: { in: [...LINKED] } },
    select: {
      kyivDay: true,
      matchType: true,
      reviewNote: true,
      bankStatementItem: {
        select: {
          id: true,
          time: true,
          amount: true,
          paymentNumber: true,
          account: { select: { altegioAccountId: true, altegioAccountTitle: true } },
        },
      },
    },
  });

  for (const row of rest) {
    const candidates = matches.filter((match) => {
      if (match.kyivDay !== row.kyivDay) return false;
      const accountId = Number(match.bankStatementItem.account.altegioAccountId) || 0;
      const bankTitle = (match.bankStatementItem.account.altegioAccountTitle || "").trim().toLowerCase();
      const payTitle = (row.accountTitle || "").trim().toLowerCase();
      return accountId === row.accountId || (bankTitle !== "" && bankTitle === payTitle);
    });
    if (candidates.length === 0) continue;
    const name = surname(row.client);
    const named = name
      ? candidates.filter((match) => (match.reviewNote || "").toLowerCase().includes(name))
      : [];
    const pool = named.length > 0 ? named : candidates;
    const best = [...pool].sort((a, b) => {
      const distance =
        kopDistance(a.bankStatementItem.amount, row.amount) - kopDistance(b.bankStatementItem.amount, row.amount);
      if (distance !== 0n) return distance < 0n ? -1 : 1;
      return a.bankStatementItem.time.getTime() - b.bankStatementItem.time.getTime();
    })[0];
    const dayBundle = pool.some(
      (match) => match.matchType === "acquiring_batch" || /рахунок за день/i.test(match.reviewNote || ""),
    );
    const close = kopDistance(best.bankStatementItem.amount, row.amount) <= 100n;
    if (!(named.length > 0 || candidates.length === 1 || dayBundle || close)) continue;
    links.set(row.id, toRef(best.bankStatementItem));
  }

  return links;
}
