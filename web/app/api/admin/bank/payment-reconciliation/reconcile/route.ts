import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { reconcileBankAltegioPayments } from "@/lib/bank/altegio-payment-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const result = await reconcileBankAltegioPayments({
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[payment-reconciliation/reconcile] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка зведення платежів" },
      { status: 500 },
    );
  }
}
