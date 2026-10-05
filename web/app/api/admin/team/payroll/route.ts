import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { buildPayrollMonth } from "@/lib/team/pay-accrual-month";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTeamSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  const month = String(req.nextUrl.searchParams.get("month") || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "Місяць має бути у форматі YYYY-MM" }, { status: 400 });
  }
  try {
    const payroll = await buildPayrollMonth(month);
    return NextResponse.json({ ok: true, ...payroll });
  } catch (err) {
    console.error("[api/admin/team/payroll] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка нарахування" },
      { status: 500 },
    );
  }
}
