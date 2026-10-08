// Залишки готівкових кас: баланс Altegio плюс рухи Kresco, які в Altegio не відправлялись.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";

export type CashCurrency = "UAH" | "USD" | "EUR";

export type CashBalanceTile = {
  id: number;
  title: string;
  currency: CashCurrency;
  /** Книжковий залишок у грн: Altegio + локальні оплати і документи. */
  balanceUah: number;
  /** Скільки валюти реально прийняли в Kresco і ще не відправили в Altegio. */
  balanceFx: number | null;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function currencyOf(title: string): CashCurrency {
  if (isUsdCashAccountTitle(title)) return "USD";
  if (isEurCashAccountTitle(title)) return "EUR";
  return "UAH";
}

function sortTiles(a: CashBalanceTile, b: CashBalanceTile): number {
  const rank = (t: CashBalanceTile) => (t.currency === "UAH" ? 0 : t.currency === "USD" ? 1 : 2);
  const byCurrency = rank(a) - rank(b);
  if (byCurrency !== 0) return byCurrency;
  return a.title.localeCompare(b.title, "uk");
}

export async function listCashBalances(): Promise<CashBalanceTile[]> {
  const accounts = await fetchAltegioAccounts();
  const cash = accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      balanceUah: account.rawBalance != null ? money(account.rawBalance) : 0,
    }))
    .filter((account) => account.id > 0 && isCashAltegioAccount(account.title));

  const ids = cash.map((account) => account.id);
  const uahById = new Map(cash.map((account) => [account.id, account.balanceUah]));
  const fxById = new Map<number, number>();

  if (ids.length === 0) {
    console.log("[finance/cash] Готівкових рахунків Altegio немає");
    return [];
  }

  const [payments, documents] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      where: { altegioTransactionId: null, accountId: { in: ids } },
      select: { accountId: true, amount: true, amountFx: true, currencyCode: true },
    }),
    prisma.financeDocument.findMany({
      where: {
        syncStatus: "local",
        status: { not: "void" },
        OR: [{ accountId: { in: ids } }, { counterAccountId: { in: ids } }],
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

  const tiles = cash
    .map((account) => {
      const currency = currencyOf(account.title);
      const fx = fxById.get(account.id);
      return {
        id: account.id,
        title: account.title,
        currency,
        balanceUah: uahById.get(account.id) || 0,
        balanceFx: currency !== "UAH" && fx != null && fx > 0 ? fx : null,
      };
    })
    .sort(sortTiles);

  console.log(
    `[finance/cash] Каси: ${tiles.map((t) => `${t.title}=${t.balanceUah} грн${t.balanceFx != null ? ` / ${t.balanceFx} ${t.currency}` : ""}`).join("; ")}`,
  );
  return tiles;
}
