// GET /api/admin/dashboard/cash — залишки кас, рахунків і завдатків зараз (від періоду не залежать).

import { NextRequest, NextResponse } from "next/server";
import { loadDashboardCash } from "@/lib/dashboard/cash";
import { requireDashboardSection } from "@/lib/dashboard/require-dashboard-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireDashboardSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await loadDashboardCash());
  } catch (err) {
    console.error("[dashboard/cash] Не вдалося порахувати залишки:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося порахувати залишки" },
      { status: 500 },
    );
  }
}
