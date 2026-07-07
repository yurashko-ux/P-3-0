import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  fetchChainClientDeposits,
  fetchDepositsForClientIds,
  type AltegioClientDeposit,
} from "@/lib/altegio/client-deposits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function parseClientIds(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  return [...new Set(
    raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((id) => Number.isFinite(id) && id > 0),
  )];
}

function mapDepositAccount(item: AltegioClientDeposit) {
  return {
    depositId: item.depositId,
    clientId: item.clientId,
    clientName: item.clientName,
    depositTypeTitle: item.depositTypeTitle,
    balance: item.balance,
  };
}

function sumPositiveBalance(
  accounts: ReturnType<typeof mapDepositAccount>[],
): number {
  const sum = accounts
    .filter((item) => item.balance > 0)
    .reduce((total, item) => total + item.balance, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Баланси депозитів Altegio — лише для вкладки ЗАВДАТКИ (не блокує основне завантаження).
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const clientIds = parseClientIds(req.nextUrl.searchParams.get("clientIds"));

    // Швидкий шлях: рахунки клієнтів з вкладки (deposits/company/client/{id}).
    if (clientIds.length > 0) {
      const targeted = await fetchDepositsForClientIds({ clientIds, concurrency: 3 });
      const accounts = targeted.deposits.map(mapDepositAccount);

      if (targeted.errors.length > 0) {
        console.warn("[payment-reconciliation/incoming/deposit-tab-data] targeted:", targeted.errors);
      }

      return NextResponse.json({
        ok: true,
        depositBalances: {
          totalBalance: sumPositiveBalance(accounts),
          source: "deposits_location_targeted",
          accounts,
        },
      });
    }

    // Fallback: повний список з deposits/chain (повільніше).
    const chainResult = await fetchChainClientDeposits({
      balanceFrom: 0.01,
      includeZeroBalance: false,
      maxPages: 10,
    }).catch((error) => {
      console.warn("[payment-reconciliation/incoming/deposit-tab-data] chain:", error);
      return null;
    });

    if (!chainResult) {
      return NextResponse.json({ ok: true, depositBalances: null });
    }

    const accounts = chainResult.deposits.map(mapDepositAccount);

    return NextResponse.json({
      ok: true,
      depositBalances: {
        totalBalance: chainResult.totalBalance,
        source: chainResult.source,
        accounts,
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
