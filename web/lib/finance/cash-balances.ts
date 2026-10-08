// Залишки рахунків для розділу Каса.
// Готівка: баланс Altegio плюс рухи Kresco, які в Altegio не відправлялись.
// Безготівка: баланс зі зведення (Altegio). Якщо в банку є незведений платіж — поруч фактичний баланс monobank.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";

export type CashCurrency = "UAH" | "USD" | "EUR";

export type CashBalanceTile = {
  id: number;
  title: string;
  currency: CashCurrency;
  /** Готівка: Altegio + локальні рухи. Безготівка: баланс зі зведення (Altegio). */
  balanceUah: number;
  /** Скільки валюти реально прийняли в Kresco і ще не відправили в Altegio. */
  balanceFx: number | null;
  /** Фактичний баланс monobank, якщо є незведений банківський платіж. */
  factBalanceUah: number | null;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function currencyOf(title: string): CashCurrency {
  if (isUsdCashAccountTitle(title)) return "USD";
  if (isEurCashAccountTitle(title)) return "EUR";
  return "UAH";
}

function isClientDepositTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

function sortTiles(a: CashBalanceTile, b: CashBalanceTile): number {
  const cashRank = (t: CashBalanceTile) => {
    if (!isCashAltegioAccount(t.title)) return 3;
    if (t.currency === "USD") return 1;
    if (t.currency === "EUR") return 2;
    return 0;
  };
  const byKind = cashRank(a) - cashRank(b);
  if (byKind !== 0) return byKind;
  return a.title.localeCompare(b.title, "uk");
}

function kopToUah(kop: bigint): number {
  return money(Number(kop) / 100);
}

export async function listCashBalances(): Promise<CashBalanceTile[]> {
  const accounts = await fetchAltegioAccounts();
  const listed = accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      balanceUah: account.rawBalance != null ? money(account.rawBalance) : 0,
      cash: isCashAltegioAccount(account.title),
    }))
    .filter((account) => account.id > 0 && !isClientDepositTitle(account.title));

  const ids = listed.map((account) => account.id);
  const cashIds = listed.filter((account) => account.cash).map((account) => account.id);
  const uahById = new Map(listed.map((account) => [account.id, account.balanceUah]));
  const fxById = new Map<number, number>();

  if (ids.length === 0) {
    console.log("[finance/cash] Рахунків Altegio немає");
    return [];
  }

  const [payments, documents] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      where: { altegioTransactionId: null, accountId: { in: cashIds.length > 0 ? cashIds : [-1] } },
      select: { accountId: true, amount: true, amountFx: true, currencyCode: true },
    }),
    prisma.financeDocument.findMany({
      where: {
        syncStatus: "local",
        status: { not: "void" },
        OR: [
          { accountId: { in: cashIds.length > 0 ? cashIds : [-1] } },
          { counterAccountId: { in: cashIds.length > 0 ? cashIds : [-1] } },
        ],
      },
      select: {
        type: true,
        amountUah: true,
        accountId: true,
        counterAccountId: true,
      },
    }),
  ]);

  for (const payment of payments) {
    uahById.set(payment.accountId, money((uahById.get(payment.accountId) || 0) + payment.amount));
    const fx = payment.amountFx != null && payment.amountFx > 0 ? payment.amountFx : 0;
    const code = String(payment.currencyCode || "").toUpperCase();
    if (fx > 0 && (code === "USD" || code === "EUR")) {
      fxById.set(payment.accountId, money((fxById.get(payment.accountId) || 0) + fx));
    }
  }

  const addUah = (accountId: number | null | undefined, delta: number) => {
    const id = Number(accountId) || 0;
    if (!uahById.has(id)) return;
    uahById.set(id, money((uahById.get(id) || 0) + delta));
  };

  for (const doc of documents) {
    const amount = money(doc.amountUah);
    if (!(amount > 0)) continue;
    if (doc.type === "income") addUah(doc.accountId, amount);
    else if (doc.type === "expense") addUah(doc.accountId, -amount);
    else if (doc.type === "transfer") {
      addUah(doc.accountId, -amount);
      addUah(doc.counterAccountId, amount);
    }
  }

  const factByAltegioId = await loadUnreconciledBankFacts(
    listed.filter((account) => !account.cash).map((account) => account.id),
  );

  const tiles = listed
    .map((account) => {
      const currency = currencyOf(account.title);
      const fx = fxById.get(account.id);
      return {
        id: account.id,
        title: account.title,
        currency,
        balanceUah: uahById.get(account.id) || 0,
        balanceFx: account.cash && currency !== "UAH" && fx != null && fx > 0 ? fx : null,
        factBalanceUah: account.cash ? null : factByAltegioId.get(account.id) ?? null,
      };
    })
    .sort(sortTiles);

  console.log(
    `[finance/cash] Рахунки: ${tiles
      .map((t) => {
        const fx = t.balanceFx != null ? ` / ${t.balanceFx} ${t.currency}` : "";
        const fact = t.factBalanceUah != null ? ` факт=${t.factBalanceUah}` : "";
        return `${t.title}=${t.balanceUah} грн${fx}${fact}`;
      })
      .join("; ")}`,
  );
  return tiles;
}

/** Фактичний баланс monobank по рахунку Altegio, якщо є хоч один незведений банківський платіж. */
async function loadUnreconciledBankFacts(altegioIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (altegioIds.length === 0) return out;

  const bankAccounts = await prisma.bankAccount.findMany({
    where: {
      includeInOperationsTable: true,
      altegioAccountId: { in: altegioIds.map(String) },
    },
    select: { id: true, altegioAccountId: true, balance: true },
  });
  if (bankAccounts.length === 0) return out;

  const unmatched = await prisma.bankStatementItem.findMany({
    where: {
      accountId: { in: bankAccounts.map((account) => account.id) },
      OR: [
        {
          amount: { gt: BigInt(0) },
          altegioIncomingMatch: null,
          altegioDepositMatch: null,
        },
        {
          amount: { lt: BigInt(0) },
          altegioPaymentMatch: null,
        },
      ],
    },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const unmatchedBankIds = new Set(unmatched.map((row) => row.accountId));

  const byAltegio = new Map<number, { balance: number; unmatched: boolean }>();
  for (const account of bankAccounts) {
    const altegioId = Number(account.altegioAccountId) || 0;
    if (!(altegioId > 0)) continue;
    const current = byAltegio.get(altegioId) || { balance: 0, unmatched: false };
    current.balance = money(current.balance + kopToUah(account.balance));
    if (unmatchedBankIds.has(account.id)) current.unmatched = true;
    byAltegio.set(altegioId, current);
  }

  for (const [altegioId, row] of byAltegio) {
    if (row.unmatched) out.set(altegioId, row.balance);
  }
  return out;
}
