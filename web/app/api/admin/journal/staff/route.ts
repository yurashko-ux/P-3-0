import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { listJournalStaffFromAltegio, hasAssignedPosition } from "@/lib/journal/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const staff = (await listJournalStaffFromAltegio()).filter(hasAssignedPosition);
    return NextResponse.json({ ok: true, staff });
  } catch (err) {
    console.error("[api/admin/journal/staff] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка штату" },
      { status: 500 },
    );
  }
}
