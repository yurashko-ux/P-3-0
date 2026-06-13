import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { unmatchBankAltegioPayment } from "@/lib/bank/altegio-payment-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankStatementItemId = typeof body.bankStatementItemId === "string" ? body.bankStatementItemId : "";
    if (!bankStatementItemId) {
      return NextResponse.json({ ok: false, error: "bankStatementItemId обов'язковий" }, { status: 400 });
    }
    const match = await unmatchBankAltegioPayment(bankStatementItemId);
    return NextResponse.json({ ok: true, match });
  } catch (error) {
    console.error("[payment-reconciliation/unmatch] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка зняття зв'язку" },
      { status: 500 },
    );
  }
}
