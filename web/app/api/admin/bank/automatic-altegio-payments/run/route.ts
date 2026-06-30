import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  DEFAULT_ADMIN_BACKFILL_KYIV_MONTH,
  runAutomaticAltegioPayments,
} from "@/lib/bank/automatic-altegio-payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST: запуск автоматичних платежів Altegio (еквайринг-комісія, термінал). */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const acquiring = body.acquiring === true;
    const terminal = body.terminal !== false;
    const sendTelegram = body.sendTelegram !== false;

    const kyivMonth =
      typeof body.kyivMonth === "string" && body.kyivMonth.trim()
        ? body.kyivMonth.trim()
        : DEFAULT_ADMIN_BACKFILL_KYIV_MONTH;
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom.trim() : undefined;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo.trim() : undefined;
    const lookbackDays = typeof body.lookbackDays === "number" ? body.lookbackDays : undefined;

    const result = await runAutomaticAltegioPayments({
      acquiring,
      terminal,
      kyivMonth: dateFrom && dateTo ? undefined : kyivMonth,
      dateFrom,
      dateTo,
      lookbackDays,
      sendTelegram,
    });

    return NextResponse.json({
      ok: true,
      period: dateFrom && dateTo ? `${dateFrom}…${dateTo}` : kyivMonth,
      ...result,
    });
  } catch (error) {
    console.error("[admin/bank/automatic-altegio-payments/run] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка автоматичних платежів" },
      { status: 500 },
    );
  }
}
