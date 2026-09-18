import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { closeVisitFromKresco, getCheckoutContext } from "@/lib/journal/checkout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const ctx = await getCheckoutContext(params.id);
    return NextResponse.json({
      ok: true,
      appointment: ctx.appointment,
      accounts: ctx.accounts,
      altegioPaid: ctx.altegioPaid,
      altegioPayments: ctx.altegioPayments,
      alreadyPaid: ctx.alreadyPaid,
      checkout: ctx.appointment.checkout,
    });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id/checkout] GET error:", err);
    const message = err instanceof Error ? err.message : "Помилка каси";
    const status = /не знайдено|видалено/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const services = Array.isArray(body.services)
      ? body.services.map((s: any) => ({
          lineId: s.lineId ? String(s.lineId) : undefined,
          altegioServiceId: Number(s.altegioServiceId) || 0,
          title: typeof s.title === "string" ? s.title : undefined,
          amount: s.amount != null ? Number(s.amount) : 1,
          cost: Number(s.cost) || 0,
        }))
      : [];
    const checkout = await closeVisitFromKresco({
      appointmentId: params.id,
      services,
      accountId: Number(body.accountId) || 0,
      accountTitle: typeof body.accountTitle === "string" ? body.accountTitle : undefined,
      comment: typeof body.comment === "string" ? body.comment : undefined,
    });
    return NextResponse.json({ ok: true, checkout });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id/checkout] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка закриття візиту";
    const status = /вкажіть|оберіть|немає|не знайдено|більше 0|депозит/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
