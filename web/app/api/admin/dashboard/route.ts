// GET /api/admin/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD — показники дашборду власника за період.

import { NextRequest, NextResponse } from "next/server";
import { loadDashboard } from "@/lib/dashboard/data";
import { daysBetween, isYmd, kyivToday, MAX_PERIOD_DAYS } from "@/lib/dashboard/period";
import { requireDashboardSection } from "@/lib/dashboard/require-dashboard-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireDashboardSection(req);
  if (auth instanceof NextResponse) return auth;

  const today = kyivToday();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = isYmd(fromParam) ? fromParam : today;
  const to = isYmd(toParam) ? toParam : from;
  if (to < from) {
    return NextResponse.json({ ok: false, error: "Кінцева дата раніша за початкову" }, { status: 400 });
  }
  if (daysBetween(from, to) > MAX_PERIOD_DAYS) {
    return NextResponse.json(
      { ok: false, error: `Період задовгий: можна обрати щонайбільше ${MAX_PERIOD_DAYS} дні` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await loadDashboard(from, to));
  } catch (err) {
    console.error(`[dashboard] Не вдалося зібрати показники ${from}…${to}:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося зібрати показники" },
      { status: 500 },
    );
  }
}
