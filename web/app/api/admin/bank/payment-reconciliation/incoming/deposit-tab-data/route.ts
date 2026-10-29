import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  fetchChainClientDeposits,
  type AltegioClientDeposit,
} from "@/lib/altegio/client-deposits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Повний обхід deposits/company по клієнтах (clients/search без balance) може зайняти кілька хвилин. */
export const maxDuration = 300;

function mapDepositAccount(item: AltegioClientDeposit) {
  return {
    depositId: item.depositId,
    clientId: item.clientId,
    clientName: item.clientName,
    clientPhone: item.clientPhone,
    depositTypeTitle: item.depositTypeTitle,
    balance: item.balance,
  };
}

function sumPositiveBalance(accounts: ReturnType<typeof mapDepositAccount>[]): number {
  const sum = accounts
    .filter((item) => item.balance > 0)
    .reduce((total, item) => total + item.balance, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Повні залишки «Рахунки клієнта» Altegio для вкладки ЗАВДАТКИ.
 * Сума в шапці = сума рядків з balance > 0 (хто реально висить на депозиті).
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await fetchChainClientDeposits({
      balanceFrom: 0.01,
      limitPerPage: 100,
      maxPages: 80,
      maxClientsToScan: 5000,
    });

    const accounts = result.deposits
      .filter((item) => item.balance > 0)
      .map(mapDepositAccount)
      .sort((a, b) => b.balance - a.balance || String(a.clientName || "").localeCompare(String(b.clientName || ""), "uk"));

    const totalBalance = sumPositiveBalance(accounts);

    console.log("[payment-reconciliation/incoming/deposit-tab-data] Повні залишки", {
      source: result.source,
      accounts: accounts.length,
      totalBalance,
      pagesFetched: result.pagesFetched,
    });

    return NextResponse.json({
      ok: true,
      depositBalances: {
        totalBalance,
        source: result.source,
        accounts,
        pagesFetched: result.pagesFetched ?? null,
        clientsChecked: result.clientsChecked ?? null,
      },
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming/deposit-tab-data] Помилка:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Не вдалося завантажити баланси завдатків",
      },
      { status: 500 },
    );
  }
}
