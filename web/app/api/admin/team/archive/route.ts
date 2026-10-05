import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { listHiddenTeamMembers } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTeamSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const members = await listHiddenTeamMembers();
    return NextResponse.json({ ok: true, members });
  } catch (err) {
    console.error("[api/admin/team/archive] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка архіву" },
      { status: 500 },
    );
  }
}
