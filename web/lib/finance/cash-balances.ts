// Залишки рахунків для розділу Каса.
// Готівка: ручний старт на кінець дня + оплати і документи Kresco з наступного дня.
// Безготівка: фактичний баланс monobank. Зведення платежів тут не рахуємо.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import {
  CASH_OPENING_EUR,
  CASH_OPENING_KYIV_DAY,
  CASH_OPENING_UAH,
  CASH_OPENING_USD,
} from "@/lib/finance/cash-openings";
import { hiddenFinanceAccountIds } from "@/lib/finance/account-archive";

export type CashCurrency = "UAH" | "USD" | "EUR";

export type CashBalanceTile = {
  id: number;
  title: string;
  currency: CashCurrency;
  cash: boolean;
  /** Готівка в грн або фактичний баланс банку. null — суми немає. */
  balanceUah: number | null;
  /** Залишок у валюті каси. null — валютний старт ще не заданий або це гривня. */
  balanceFx: number | null;
  /** Готівкова каса без початкового залишку. */
  openingPending: boolean;
  /** Безготівковий рахунок прив’язаний до monobank. */
  hasBank: boolean;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function currencyOf(title: string): CashCurrency {
  if (isUsdCashAccountTitle(title)) return "USD";
  if (isEurCashAccountTitle(title)) return "EUR";
  return "UAH";
}

function openingOf(currency: CashCurrency): number | null {
  if (currency === "USD") return CASH_OPENING_USD;
  if (currency === "EUR") return CASH_OPENING_EUR;
  return CASH_OPENING_UAH;
}

function isClientDepositTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

function sortTiles(a: CashBalanceTile, b: CashBalanceTile): number {
  const cashRank = (t: CashBalanceTile) => {
    if (!t.cash) return 3;
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
  const [accounts, hiddenIds] = await Promise.all([fetchAltegioAccounts(), hiddenFinanceAccountIds()]);
  const listed = accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      cash: isCashAltegioAccount(account.title),
      currency: currencyOf(account.title),
    }))
    .filter(
      (account) => account.id > 0 && !isClientDepositTitle(account.title) && !hiddenIds.has(account.id),
    );

  if (listed.length === 0) {
    console.log("[finance/cash] Рахунків Altegio немає");
    return [];
  }

  const cashAccounts = listed.filter((account) => account.cash && openingOf(account.currency) != null);
  const cashIds = cashAccounts.map((account) => account.id);
  const uahExtra = new Map<number, number>();
  const fxExtra = new Map<number, number>();

  if (cashIds.length > 0) {
    const [payments, documents] = await Promise.all([
      prisma.salonCheckoutPayment.findMany({
        where: {
          accountId: { in: cashIds },
          checkout: { kyivDay: { gt: CASH_OPENING_KYIV_DAY } },
        },
        select: { accountId: true, amount: true, amountFx: true, currencyCode: true },
      }),
      prisma.financeDocument.findMany({
        where: {
          source: "kresco",
          status: { not: "void" },
          kyivDay: { gt: CASH_OPENING_KYIV_DAY },
          OR: [{ accountId: { in: cashIds } }, { counterAccountId: { in: cashIds } }],
        },
        select: {
          type: true,
          amountUah: true,
          accountId: true,
          counterAccountId: true,
        },
      }),
    ]);

    const currencyById = new Map(cashAccounts.map((account) => [account.id, account.currency]));
    for (const payment of payments) {
      const currency = currencyById.get(payment.accountId) || "UAH";
      const code = String(payment.currencyCode || "").toUpperCase();
      const fx = payment.amountFx != null && payment.amountFx > 0 ? payment.amountFx : 0;
      if (currency !== "UAH" && fx > 0 && code === currency) {
        fxExtra.set(payment.accountId, money((fxExtra.get(payment.accountId) || 0) + fx));
      } else {
        uahExtra.set(payment.accountId, money((uahExtra.get(payment.accountId) || 0) + payment.amount));
      }
    }

    const addUah = (accountId: number | null | undefined, delta: number) => {
      const id = Number(accountId) || 0;
      if (!currencyById.has(id)) return;
      uahExtra.set(id, money((uahExtra.get(id) || 0) + delta));
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
  }

  const bankByAltegio = await loadBankBalances(listed.filter((account) => !account.cash).map((account) => account.id));

  const tiles = listed
    .map((account) => {
      if (!account.cash) {
        const bank = bankByAltegio.get(account.id);
        return {
          id: account.id,
          title: account.title,
          currency: account.currency,
          cash: false,
          balanceUah: bank ?? null,
          balanceFx: null,
          openingPending: false,
          hasBank: bank != null,
        };
      }
      const opening = openingOf(account.currency);
      if (opening == null) {
        return {
          id: account.id,
          title: account.title,
          currency: account.currency,
          cash: true,
          balanceUah: null,
          balanceFx: null,
          openingPending: true,
          hasBank: false,
        };
      }
      const fxDelta = fxExtra.get(account.id) || 0;
      const uahDelta = uahExtra.get(account.id) || 0;
      if (account.currency === "UAH") {
        return {
          id: account.id,
          title: account.title,
          currency: account.currency,
          cash: true,
          balanceUah: money(opening + uahDelta),
          balanceFx: null,
          openingPending: false,
          hasBank: false,
        };
      }
      return {
        id: account.id,
        title: account.title,
        currency: account.currency,
        cash: true,
        balanceFx: money(opening + fxDelta),
        balanceUah: uahDelta !== 0 ? uahDelta : null,
        openingPending: false,
        hasBank: false,
      };
    })
    .sort(sortTiles);

  console.log(
    `[finance/cash] Рахунки з ${CASH_OPENING_KYIV_DAY}: ${tiles
      .map((tile) => {
        if (tile.openingPending) return `${tile.title}=старт не заданий`;
        if (!tile.cash && !tile.hasBank) return `${tile.title}=немає банку`;
        const fx = tile.balanceFx != null ? `${tile.balanceFx} ${tile.currency}` : "";
        const uah = tile.balanceUah != null ? `${tile.balanceUah} грн` : "";
        return `${tile.title}=${[fx, uah].filter(Boolean).join(" / ")}`;
      })
      .join("; ")}`,
  );
  return tiles;
}

async function loadBankBalances(altegioIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (altegioIds.length === 0) return out;
  const bankAccounts = await prisma.bankAccount.findMany({
    where: {
      includeInOperationsTable: true,
      altegioAccountId: { in: altegioIds.map(String) },
    },
    select: { altegioAccountId: true, balance: true },
  });
  for (const account of bankAccounts) {
    const altegioId = Number(account.altegioAccountId) || 0;
    if (!(altegioId > 0)) continue;
    out.set(altegioId, money((out.get(altegioId) || 0) + kopToUah(account.balance)));
  }
  return out;
}
