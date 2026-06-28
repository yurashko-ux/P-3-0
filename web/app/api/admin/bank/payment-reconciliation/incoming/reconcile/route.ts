import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { reconcileIncomingPaymentsForKyivDay } from "@/lib/bank/incoming-payment-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const day = typeof body.day === "string" ? body.day.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json(
        { ok: false, error: "Потрібен параметр day у форматі YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const dryRun = body.dryRun === true;
    const matchedBy =
      typeof body.matchedBy === "string" && body.matchedBy.trim()
        ? body.matchedBy.trim()
        : "test_incoming_reconcile";

    const result = await reconcileIncomingPaymentsForKyivDay(day, { dryRun, matchedBy });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[payment-reconciliation/incoming/reconcile] Помилка:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка автозведення вхідних платежів",
      },
      { status: 500 },
    );
  }
}
