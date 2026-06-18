import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const kyivDay = req.nextUrl.searchParams.get("kyivDay") || "2026-06-10";
    const preview = await buildIncomingReconciliationPreview(kyivDay);
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    console.error("[payment-reconciliation/incoming] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити вхідні платежі" },
      { status: 500 },
    );
  }
}
