import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  fetchChainClientDeposits,
  fetchDepositsForClientIds,
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

/**
 * Баланси депозитів Altegio — лише для вкладки ЗАВДАТКИ (не блокує основне завантаження).
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const clientIds = parseClientIds(req.nextUrl.searchParams.get("clientIds"));

    let depositBalancesResult: {
      totalBalance: number;
      source: string;
      deposits: Array<{
        depositId: number;
        clientId: number | null;
        clientName: string | null;
        depositTypeTitle: string | null;
        balance: number;
      }>;
    } | null = null;

    if (clientIds.length > 0) {
      const targeted = await fetchDepositsForClientIds({ clientIds });
      depositBalancesResult = {
        totalBalance: targeted.totalBalance,
        source: "deposits_location_targeted",
        deposits: targeted.deposits.map((item) => ({
          depositId: item.depositId,
          clientId: item.clientId,
          clientName: item.clientName,
          depositTypeTitle: item.depositTypeTitle,
          balance: item.balance,
        })),
      };
      if (targeted.errors.length > 0) {
        console.warn("[payment-reconciliation/incoming/deposit-tab-data] targeted errors:", targeted.errors);
      }
    } else {
      const chainResult = await fetchChainClientDeposits({
        balanceFrom: 0.01,
        includeZeroBalance: false,
        maxPages: 5,
      }).catch((error) => {
        console.warn("[payment-reconciliation/incoming/deposit-tab-data] chain fallback:", error);
        return null;
      });
      if (chainResult) {
        depositBalancesResult = {
          totalBalance: chainResult.totalBalance,
          source: chainResult.source,
          deposits: chainResult.deposits.map((item) => ({
            depositId: item.depositId,
            clientId: item.clientId,
            clientName: item.clientName,
            depositTypeTitle: item.depositTypeTitle,
            balance: item.balance,
          })),
        };
      }
    }

    return NextResponse.json({
      ok: true,
      depositBalances: depositBalancesResult,
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
