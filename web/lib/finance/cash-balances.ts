// Залишки рахунків для розділу Каса.
// Готівка: баланс після останньої касовки (bookUah). Надлишок у нього не входить.
// Непроведені платежі і надлишок або недостача — окремими рядками знизу.
// Якщо касовки ще не було — початковий залишок. Безготівка: фактичний баланс monobank.

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
import { openCashNetsForAccounts } from "@/lib/finance/cash-posting";

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
  /** Остання касовка цієї каси за сьогодні (Київ), у валюті каси. null — сьогодні не рахували. */
  countedUah: number | null;
  /** Сума ще не проведених платежів після останньої збіжної касовки. */
  openPaymentsNet: number;
  /** Кількість ще не проведених платежів. */
  openPaymentsCount: number;
  /** Найстаріший день серед непроведених платежів (Europe/Kyiv). */
  openPaymentsFromKyivDay: string | null;
  /** Останнє значення «Пораховані» з касовки цієї каси. */
  lastBundledAmount: number | null;
  /** Факт мінус очікувана за останньою касовкою. >0 надлишок, <0 недостача, null — розбіжності немає. */
  variance: number | null;
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
          countedUah: null,
          openPaymentsNet: 0,
          openPaymentsCount: 0,
          openPaymentsFromKyivDay: null,
          lastBundledAmount: null,
          variance: null,
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
          countedUah: null,
          openPaymentsNet: 0,
          openPaymentsCount: 0,
          openPaymentsFromKyivDay: null,
          lastBundledAmount: null,
          variance: null,
        };
      }
      if (account.currency === "UAH") {
        return {
          id: account.id,
          title: account.title,
          currency: account.currency,
          cash: true,
          balanceUah: money(opening),
          balanceFx: null,
          openingPending: false,
          hasBank: false,
          countedUah: null,
          openPaymentsNet: 0,
          openPaymentsCount: 0,
          openPaymentsFromKyivDay: null,
          lastBundledAmount: null,
          variance: null,
        };
      }
      return {
        id: account.id,
        title: account.title,
        currency: account.currency,
        cash: true,
        balanceFx: money(opening),
        balanceUah: null,
        openingPending: false,
        hasBank: false,
        countedUah: null,
        openPaymentsNet: 0,
        openPaymentsCount: 0,
        openPaymentsFromKyivDay: null,
        lastBundledAmount: null,
        variance: null,
      };
    })
    .sort(sortTiles);

  const cashTiles = tiles.filter((tile) => tile.cash && !tile.openingPending);
  const countableIds = cashTiles.map((tile) => tile.id);
  if (countableIds.length > 0) {
    const [counts, allCounts, openNets] = await Promise.all([
      prisma.cashTillCount.findMany({
        where: {
          accountId: { in: countableIds },
          OR: [{ bookUah: { not: null } }, { matchedBook: true }],
        },
        orderBy: { createdAt: "desc" },
        select: { accountId: true, countedUah: true, bookUah: true, varianceUah: true },
      }),
      prisma.cashTillCount.findMany({
        where: { accountId: { in: countableIds } },
        orderBy: { createdAt: "desc" },
        select: { accountId: true, bundledAmount: true },
      }),
      openCashNetsForAccounts(
        cashTiles.map((tile) => ({ id: tile.id, title: tile.title, currency: tile.currency })),
      ),
    ]);
    const latest = new Map<number, { book: number; counted: number; variance: number | null }>();
    for (const row of counts) {
      if (latest.has(row.accountId)) continue;
      const variance = row.varianceUah == null ? null : money(row.varianceUah);
      latest.set(row.accountId, {
        book: money(row.bookUah != null ? row.bookUah : row.countedUah),
        counted: money(row.countedUah),
        variance: variance != null && Math.abs(variance) >= 0.01 ? variance : null,
      });
    }
    const latestBundled = new Map<number, number>();
    for (const row of allCounts) {
      if (!latestBundled.has(row.accountId)) {
        latestBundled.set(row.accountId, money(row.bundledAmount || 0));
      }
    }
    for (const tile of tiles) {
      const counted = latest.get(tile.id);
      if (counted != null) {
        if (tile.currency === "UAH") tile.balanceUah = counted.book;
        else tile.balanceFx = counted.book;
        tile.countedUah = counted.counted;
        tile.variance = counted.variance;
      }
      const bundled = latestBundled.get(tile.id);
      if (bundled != null) tile.lastBundledAmount = bundled;
      const open = openNets.get(tile.id);
      if (open) {
        tile.openPaymentsNet = open.net;
        tile.openPaymentsCount = open.count;
        tile.openPaymentsFromKyivDay = open.fromKyivDay;
      }
    }
  }

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
