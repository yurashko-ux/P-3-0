import { NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { fetchChainClientDeposits } from "@/lib/altegio/client-deposits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Баланси депозитів Altegio — лише для вкладки ЗАВДАТКИ (не блокує основне завантаження).
 */
export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const depositBalancesResult = await fetchChainClientDeposits({
      balanceFrom: 0.01,
      includeZeroBalance: false,
    }).catch((error) => {
      console.warn("[payment-reconciliation/incoming/deposit-tab-data] depositBalances:", error);
      return null;
    });

    const depositBalances = depositBalancesResult
      ? {
          totalBalance: depositBalancesResult.totalBalance,
          source: depositBalancesResult.source,
          accounts: depositBalancesResult.deposits.map((item) => ({
            depositId: item.depositId,
            clientId: item.clientId,
            clientName: item.clientName,
            depositTypeTitle: item.depositTypeTitle,
            balance: item.balance,
          })),
        }
      : null;

    return NextResponse.json({
      ok: true,
      depositBalances,
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
