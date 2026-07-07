import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  fetchDepositsForDepositTab,
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

function parsePayerNames(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(
      parsed
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    )];
  } catch {
    return [...new Set(
      raw
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean),
    )];
  }
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
    const payerNames = parsePayerNames(req.nextUrl.searchParams.get("payerNames"));

    const result = await fetchDepositsForDepositTab({ clientIds, payerNames });
    const accounts = result.deposits.map(mapDepositAccount);

    if (result.errors.length > 0) {
      console.warn("[payment-reconciliation/incoming/deposit-tab-data]:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      depositBalances: {
        totalBalance: sumPositiveBalance(accounts),
        source: result.source,
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
