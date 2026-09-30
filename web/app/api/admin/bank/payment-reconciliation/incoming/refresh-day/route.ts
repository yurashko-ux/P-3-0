import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { refreshIncomingAltegioForKyivDay } from "@/lib/bank/incoming-altegio-aggregate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Один день Altegio + documents — має вкластися значно швидше за повний період. */
export const maxDuration = 120;

type Body = {
  kyivDay?: string;
};

/**
 * POST https://p-3-0.vercel.app/api/admin/bank/payment-reconciliation/incoming/refresh-day
 * Body: { kyivDay: "YYYY-MM-DD" }
 * Підтягує вхідні Altegio лише за один календарний день (Europe/Kyiv) у БД.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const kyivDay = typeof body.kyivDay === "string" ? body.kyivDay.trim() : "";
    if (!kyivDay) {
      return NextResponse.json(
        { ok: false, error: "Потрібен kyivDay (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const startedAt = Date.now();
    const refresh = await refreshIncomingAltegioForKyivDay(kyivDay);
    console.log("[payment-reconciliation/incoming/refresh-day] Готово", {
      ...refresh,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      message: `Підтягнуто Altegio за ${kyivDay}`,
      refresh,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming/refresh-day] Помилка:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Не вдалося підтягнути Altegio за день",
      },
      { status: 500 },
    );
  }
}
