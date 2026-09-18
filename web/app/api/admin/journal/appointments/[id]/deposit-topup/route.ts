import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { topUpDepositFromAppointment } from "@/lib/journal/deposit-topup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await topUpDepositFromAppointment({
      appointmentId: params.id,
      depositId: Number(body.depositId) || 0,
      amount: Number(body.amount) || 0,
      accountId: Number(body.accountId) || 0,
      accountTitle: typeof body.accountTitle === "string" ? body.accountTitle : undefined,
      comment: typeof body.comment === "string" ? body.comment : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id/deposit-topup] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка поповнення завдатку";
    const status = /оберіть|немає|не знайдено|більше 0|заблоковано|для поповнення/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
