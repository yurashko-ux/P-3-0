// Тіньовий фінзвіт за місяць: Kresco проти Altegio. Лише читання.

import { NextRequest, NextResponse } from "next/server";
import { isDirectAdminAuthorizedAsync } from "@/lib/direct-admin-auth";
import { loadFinanceReportShadow, monthRange } from "@/lib/finance/report-shadow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isDirectAdminAuthorizedAsync(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const range = monthRange(req.nextUrl.searchParams.get("month") || "");
  if (!range) {
    return NextResponse.json({ ok: false, error: "Потрібен місяць у форматі YYYY-MM" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await loadFinanceReportShadow(range.from, range.to)) });
  } catch (err) {
    console.error("[api/admin/finance-report/shadow] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка звірки" },
      { status: 500 },
    );
  }
}
