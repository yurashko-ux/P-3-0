import { NextRequest, NextResponse } from "next/server";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BALANCE_KEYS = [
  "balance",
  "actual_balance",
  "current_balance",
  "available_balance",
  "saldo",
  "sum",
  "amount",
  "total_balance",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBalanceCandidates(raw: Record<string, unknown>) {
  return BALANCE_KEYS.map((key) => {
    const directValue = raw[key];
    const nested = asRecord(directValue);

    return {
      key,
      directValue: directValue ?? null,
      nestedValue: nested
        ? {
            value: nested.value ?? null,
            amount: nested.amount ?? null,
            sum: nested.sum ?? null,
            balance: nested.balance ?? null,
          }
        : null,
    };
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const accountId = req.nextUrl.searchParams.get("accountId")?.trim() || "";
    const titleIncludes = req.nextUrl.searchParams.get("titleIncludes")?.trim().toLowerCase() || "";

    if (!accountId && !titleIncludes) {
      return NextResponse.json(
        { ok: false, error: "Передайте accountId або titleIncludes" },
        { status: 400 },
      );
    }

    const accounts = await fetchAltegioAccounts();
    const matched = accounts.filter((account) => {
      if (accountId && account.id === accountId) return true;
      if (titleIncludes && account.title.toLowerCase().includes(titleIncludes)) return true;
      return false;
    });

    return NextResponse.json({
      ok: true,
      query: {
        accountId: accountId || null,
        titleIncludes: titleIncludes || null,
      },
      matchedCount: matched.length,
      accounts: matched.map((account) => ({
        id: account.id,
        title: account.title,
        type: account.type,
        parsedBalanceKopiykas: account.balanceKopiykas?.toString() ?? null,
        rawBalance: account.rawBalance,
        rawKeys: Object.keys(account.raw).sort(),
        balanceCandidates: readBalanceCandidates(account.raw),
        raw: account.raw,
      })),
    });
  } catch (error) {
    console.error("[admin/altegio/account-debug] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
