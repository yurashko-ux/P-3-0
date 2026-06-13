import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  ignoreBankAltegioPayment,
  manualMatchBankAltegioPayment,
} from "@/lib/bank/altegio-payment-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankStatementItemId = typeof body.bankStatementItemId === "string" ? body.bankStatementItemId : "";
    const action = typeof body.action === "string" ? body.action : "match";

    if (!bankStatementItemId) {
      return NextResponse.json({ ok: false, error: "bankStatementItemId обов'язковий" }, { status: 400 });
    }

    if (action === "ignore") {
      const match = await ignoreBankAltegioPayment(
        bankStatementItemId,
        typeof body.note === "string" ? body.note : undefined,
      );
      return NextResponse.json({ ok: true, match });
    }

    const altegioFinanceTransactionId =
      typeof body.altegioFinanceTransactionId === "string" ? body.altegioFinanceTransactionId : "";
    if (!altegioFinanceTransactionId) {
      return NextResponse.json({ ok: false, error: "altegioFinanceTransactionId обов'язковий" }, { status: 400 });
    }

    const match = await manualMatchBankAltegioPayment({
      bankStatementItemId,
      altegioFinanceTransactionId,
      matchedBy: auth.userId ?? "admin",
    });
    return NextResponse.json({ ok: true, match });
  } catch (error) {
    console.error("[payment-reconciliation/match] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка ручного зведення" },
      { status: 500 },
    );
  }
}
