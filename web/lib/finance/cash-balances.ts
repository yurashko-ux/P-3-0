// Залишки рахунків для розділу Каса.
// Готівка: старт + усі рухи з дня старту. Розбіжність останньої касовки — окремим рядком знизу.
// Безготівка: фактичний баланс monobank.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import {
  CASH_OPENING_EUR,
  CASH_OPENING_KYIV_DAY,
  CASH_RECONCILE_FROM_KYIV_DAY,
  CASH_OPENING_UAH,
  CASH_OPENING_USD,
} from "@/lib/finance/cash-openings";
import { hiddenFinanceAccountIds, pausedBankAltegioAccountIds } from "@/lib/finance/account-archive";
import { listCashLedger } from "@/lib/finance/cash-posting";
import { balanceWithoutExcluded, excludedAmountKopByAccount } from "@/lib/bank/excluded-payments";

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
  /** День останньої касовки цієї каси (Europe/Kyiv), зокрема до дня старту. null — касовок не було. */
  lastCountKyivDay: string | null;
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
  const [accounts, archivedIds, pausedIds] = await Promise.all([
    fetchAltegioAccounts(),
    hiddenFinanceAccountIds(),
    pausedBankAltegioAccountIds(),
  ]);
  // Приховані: «Архів Altegio» + рахунки призупинених підключень банку (історію не чіпаємо).
  const hiddenIds = new Set([...archivedIds, ...pausedIds]);
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
          lastCountKyivDay: null,
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
          lastCountKyivDay: null,
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
          lastCountKyivDay: null,
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
        lastCountKyivDay: null,
        lastBundledAmount: null,
        variance: null,
      };
    })
    .sort(sortTiles);

  // Баланс готівкової каси = старт + усі рухи з дня старту (Kresco і Altegio), без «проведення».
  // Касовка лише порівнює факт з балансом; її розбіжність показуємо до наступної касовки.
  const cashTiles = tiles.filter((tile) => tile.cash && !tile.openingPending);
  const countableIds = cashTiles.map((tile) => tile.id);
  if (countableIds.length > 0) {
    const [counts, lastCounts, ledger] = await Promise.all([
      prisma.cashTillCount.findMany({
        where: { accountId: { in: countableIds }, kyivDay: { gte: CASH_RECONCILE_FROM_KYIV_DAY } },
        orderBy: { createdAt: "desc" },
        select: { accountId: true, countedUah: true, varianceUah: true, bundledAmount: true },
      }),
      prisma.cashTillCount.findMany({
        where: { accountId: { in: countableIds } },
        orderBy: { createdAt: "desc" },
        distinct: ["accountId"],
        select: { accountId: true, kyivDay: true },
      }),
      listCashLedger(),
    ]);
    const lastCountDay = new Map(lastCounts.map((row) => [row.accountId, row.kyivDay]));
    const latest = new Map<number, (typeof counts)[number]>();
    for (const row of counts) if (!latest.has(row.accountId)) latest.set(row.accountId, row);
    for (const tile of cashTiles) {
      const net = ledger
        .filter(
          (row) =>
            row.accountId === tile.id && row.currency === tile.currency && row.kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY,
        )
        .reduce((sum, row) => sum + (row.direction === "out" ? -row.amount : row.amount), 0);
      const opening = openingOf(tile.currency) ?? 0;
      const balance = money(opening + net);
      if (tile.currency === "UAH") tile.balanceUah = balance;
      else tile.balanceFx = balance;
      tile.lastCountKyivDay = lastCountDay.get(tile.id) ?? null;
      const count = latest.get(tile.id);
      if (count) {
        tile.countedUah = money(count.countedUah);
        const variance = count.varianceUah == null ? null : money(count.varianceUah);
        tile.variance = variance != null && Math.abs(variance) >= 0.01 ? variance : null;
        tile.lastBundledAmount = money(count.bundledAmount || 0);
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
    select: { id: true, altegioAccountId: true, balance: true },
  });
  // Виключені (чужі) платежі не рахуємо в балансі каси
  const excludedKop = await excludedAmountKopByAccount(bankAccounts.map((account) => account.id));
  for (const account of bankAccounts) {
    const altegioId = Number(account.altegioAccountId) || 0;
    if (!(altegioId > 0)) continue;
    const balance = balanceWithoutExcluded(account.balance, account.id, excludedKop);
    out.set(altegioId, money((out.get(altegioId) || 0) + kopToUah(balance)));
  }
  return out;
}
