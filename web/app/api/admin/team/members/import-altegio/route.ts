import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { importTeamMembersFromAltegio } from "@/lib/team/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await importTeamMembersFromAltegio();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/admin/team/members/import-altegio] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка імпорту штату" },
      { status: 500 },
    );
  }
}
