import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { runAutomaticAltegioPayments } from "@/lib/bank/automatic-altegio-payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST: запуск автоматичних платежів Altegio (еквайринг-комісія, термінал). */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const acquiring = body.acquiring !== false;
    const terminal = body.terminal !== false;
    const lookbackDays = typeof body.lookbackDays === "number" ? body.lookbackDays : 14;
    const sendTelegram = body.sendTelegram !== false;

    const result = await runAutomaticAltegioPayments({
      acquiring,
      terminal,
      lookbackDays,
      sendTelegram,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/bank/automatic-altegio-payments/run] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка автоматичних платежів" },
      { status: 500 },
    );
  }
}
