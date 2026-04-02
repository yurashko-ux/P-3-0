import { NextRequest, NextResponse } from "next/server";
import { syncAltegioBalanceForBankAccount } from "@/lib/altegio/accounts";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankAccountId = typeof body.bankAccountId === "string" ? body.bankAccountId.trim() : "";

    if (!bankAccountId) {
      return NextResponse.json(
        { ok: false, error: "bankAccountId is required" },
        { status: 400 },
      );
    }

    const result = await syncAltegioBalanceForBankAccount(bankAccountId);

    return NextResponse.json({
      ok: true,
      bankAccountId,
      result,
    });
  } catch (error) {
    console.error("[admin/altegio/bank-accounts-sync] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
