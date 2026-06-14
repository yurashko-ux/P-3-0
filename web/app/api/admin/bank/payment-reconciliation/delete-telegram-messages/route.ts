import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { deletePaymentReconciliationTelegramMessages } from "@/lib/bank/payment-reconciliation-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const day = typeof body.day === "string" ? body.day : undefined;
    const dryRun = body.dryRun === true;
    const limit = typeof body.limit === "number" ? body.limit : undefined;

    const result = await deletePaymentReconciliationTelegramMessages({ day, dryRun, limit });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[payment-reconciliation/delete-telegram-messages] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка видалення Telegram-повідомлень платежів" },
      { status: 500 },
    );
  }
}
