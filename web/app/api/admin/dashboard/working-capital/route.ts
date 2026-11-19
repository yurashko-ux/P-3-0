// GET /api/admin/dashboard/working-capital — обігові кошти зараз і щоденні знімки для графіка.

import { NextRequest, NextResponse } from "next/server";
import { loadDashboardWorkingCapital } from "@/lib/dashboard/working-capital";
import { requireDashboardSection } from "@/lib/dashboard/require-dashboard-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireDashboardSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await loadDashboardWorkingCapital());
  } catch (err) {
    console.error("[dashboard/working-capital] Не вдалося порахувати обігові кошти:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося порахувати обігові кошти" },
      { status: 500 },
    );
  }
}
