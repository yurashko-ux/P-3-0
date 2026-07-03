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

/**
 * Баланси депозитів Altegio — лише для вкладки ЗАВДАТКИ (не блокує основне завантаження).
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const clientIds = parseClientIds(req.nextUrl.searchParams.get("clientIds"));

    const chainResult = await fetchChainClientDeposits({
      balanceFrom: 0.01,
      includeZeroBalance: false,
    }).catch((error) => {
      console.warn("[payment-reconciliation/incoming/deposit-tab-data] chain:", error);
      return null;
    });

    const accountsByClientId = new Map<number, ReturnType<typeof mapDepositAccount>>();
    const accountsWithoutClientId: ReturnType<typeof mapDepositAccount>[] = [];

    if (chainResult) {
      for (const item of chainResult.deposits) {
        const mapped = mapDepositAccount(item);
        if (mapped.clientId != null) {
          accountsByClientId.set(mapped.clientId, mapped);
        } else {
          accountsWithoutClientId.push(mapped);
        }
      }
    }

    // Доповнити нульові / відсутні в chain рахунки клієнтів з вкладки.
    if (clientIds.length > 0) {
      const targeted = await fetchDepositsForClientIds({ clientIds });
      for (const item of targeted.deposits) {
        const mapped = mapDepositAccount(item);
        if (mapped.clientId != null && !accountsByClientId.has(mapped.clientId)) {
          accountsByClientId.set(mapped.clientId, mapped);
        }
      }
      if (targeted.errors.length > 0) {
        console.warn("[payment-reconciliation/incoming/deposit-tab-data] targeted:", targeted.errors);
      }
    }

    const accounts = [...accountsByClientId.values(), ...accountsWithoutClientId];
    if (accounts.length === 0 && !chainResult) {
      return NextResponse.json({ ok: true, depositBalances: null });
    }

    const totalBalance = chainResult?.totalBalance
      ?? accounts
        .filter((item) => item.balance > 0)
        .reduce((sum, item) => sum + item.balance, 0);

    return NextResponse.json({
      ok: true,
      depositBalances: {
        totalBalance: Math.round(totalBalance * 100) / 100,
        source: chainResult?.source ?? "deposits_location_targeted",
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
