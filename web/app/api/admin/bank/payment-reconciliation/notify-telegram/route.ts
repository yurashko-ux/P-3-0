import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  finalizePendingPaymentFromTelegram,
  notifyBankPaymentNeedsReview,
  notifyUnmatchedBankPayments,
} from "@/lib/bank/payment-reconciliation-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankStatementItemId = typeof body.bankStatementItemId === "string" ? body.bankStatementItemId : "";
    const force = body.force === true;
    const action = typeof body.action === "string" ? body.action : "notify";

    if (action === "createFromPending") {
      if (!bankStatementItemId) {
        return NextResponse.json({ ok: false, error: "bankStatementItemId обов'язковий" }, { status: 400 });
      }
      const result = await finalizePendingPaymentFromTelegram({
        bankStatementItemId,
        comment: typeof body.comment === "string" ? body.comment : null,
        createdBy: auth.userId ?? "admin",
      });
      return NextResponse.json({ ok: true, result });
    }

    const result = bankStatementItemId
      ? await notifyBankPaymentNeedsReview(bankStatementItemId, { force })
      : await notifyUnmatchedBankPayments(typeof body.limit === "number" ? body.limit : 10);

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[payment-reconciliation/notify-telegram] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка Telegram-повідомлення" },
      { status: 500 },
    );
  }
}
