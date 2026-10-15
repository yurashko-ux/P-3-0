import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { setTeamMemberJournalVisibility } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const targetIds = Array.isArray(body.targetIds) ? body.targetIds.map((v: unknown) => String(v)) : [];
    const member = await setTeamMemberJournalVisibility(params.id, targetIds);
    return NextResponse.json({ ok: true, member });
  } catch (err) {
    console.error("[api/admin/team/members/:id/journal-visibility] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка збереження видимості";
    const status = /не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
