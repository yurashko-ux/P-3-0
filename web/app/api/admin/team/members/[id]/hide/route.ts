import { NextRequest, NextResponse } from "next/server";
import { teamActor } from "@/lib/team/actor";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { hideTeamMember } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const member = await hideTeamMember(params.id, teamActor(auth));
    return NextResponse.json({ ok: true, member });
  } catch (err) {
    console.error("[api/admin/team/members/:id/hide] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка приховування";
    const status = /не знайдено/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
