import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { deletePaymentReconciliationTelegramMessages } from "@/lib/bank/payment-reconciliation-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function runCleanup(req: NextRequest, input: { day?: string; dryRun?: boolean; limit?: number }) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await deletePaymentReconciliationTelegramMessages(input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[payment-reconciliation/delete-telegram-messages] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка видалення Telegram-повідомлень платежів" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const dryRunParam = req.nextUrl.searchParams.get("dryRun");
  const limitParam = Number(req.nextUrl.searchParams.get("limit") || 0);
  return runCleanup(req, {
    day: req.nextUrl.searchParams.get("day") || undefined,
    dryRun: dryRunParam === "0" || dryRunParam === "false" ? false : true,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return runCleanup(req, {
    day: typeof body.day === "string" ? body.day : undefined,
    dryRun: body.dryRun === true,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  });
}
