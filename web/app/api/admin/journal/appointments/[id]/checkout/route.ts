import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { closeVisitFromKresco, getCheckoutContext } from "@/lib/journal/checkout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const catalogSearch = req.nextUrl.searchParams.get("catalogSearch") || undefined;
    const ctx = await getCheckoutContext(params.id, catalogSearch);
    return NextResponse.json({
      ok: true,
      appointment: ctx.appointment,
      accounts: ctx.accounts,
      storages: ctx.storages,
      catalogProducts: ctx.catalogProducts,
      clientDeposits: ctx.clientDeposits,
      altegioPaid: ctx.altegioPaid,
      altegioPayments: ctx.altegioPayments,
      alreadyPaid: ctx.alreadyPaid,
      checkout: ctx.appointment.checkout,
      usdRate: ctx.usdRate,
      usdRateSource: ctx.usdRateSource,
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
    const goods = Array.isArray(body.goods)
      ? body.goods.map((g: any) => ({
          productId: String(g.productId || ""),
          storageId: String(g.storageId || ""),
          quantity: Number(g.quantity) || 0,
          salePrice: Number(g.salePrice) || 0,
          title: typeof g.title === "string" ? g.title : undefined,
        }))
      : [];
    const depositId =
      body.depositId != null && Number(body.depositId) > 0 ? Number(body.depositId) : null;
    const payments = Array.isArray(body.payments)
      ? body.payments
          .map((p: any) => ({
            accountId: Number(p.accountId) || 0,
            amount: Number(p.amount) || 0,
            paymentKind:
              p.paymentKind === "deposit" || Number(p.depositId) > 0
                ? ("deposit" as const)
                : ("account" as const),
            depositId:
              p.depositId != null && Number(p.depositId) > 0 ? Number(p.depositId) : null,
            accountTitle: typeof p.accountTitle === "string" ? p.accountTitle : undefined,
            amountFx: p.amountFx != null ? Number(p.amountFx) : null,
            currencyCode: typeof p.currencyCode === "string" ? p.currencyCode : null,
            fxRate: p.fxRate != null ? Number(p.fxRate) : null,
          }))
          .filter((p: { amount: number; accountId: number }) => p.amount > 0 && p.accountId > 0)
      : undefined;
    const createdBy =
      auth.type === "user" && auth.userId
        ? auth.userId
        : auth.type === "superadmin"
          ? "superadmin"
          : null;
    const checkout = await closeVisitFromKresco({
      appointmentId: params.id,
      services,
      goods,
      payments,
      accountId: Number(body.accountId) || 0,
      accountTitle: typeof body.accountTitle === "string" ? body.accountTitle : undefined,
      depositId,
      comment: typeof body.comment === "string" ? body.comment : undefined,
      createdBy,
    });
    return NextResponse.json({ ok: true, checkout });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id/checkout] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка закриття візиту";
    const status = /вкажіть|оберіть|немає|не знайдено|більше 0|депозит|завдатк|без id|вимкнено|недостатньо|заблоковано|дорівнювати|розбит|платеж/i.test(
      message,
    )
      ? 400
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
