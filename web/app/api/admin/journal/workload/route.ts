import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { loadMonthWorkload } from "@/lib/journal/workload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  const month = String(req.nextUrl.searchParams.get("month") || "");
  try {
    const days = await loadMonthWorkload(month);
    return NextResponse.json({ ok: true, month, days });
  } catch (err) {
    console.error("[api/admin/journal/workload] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка завантаженості" },
      { status: 500 },
    );
  }
}
