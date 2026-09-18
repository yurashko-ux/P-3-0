import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { deleteTeamMember, updateTeamMember } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const member = await updateTeamMember(params.id, body);
    return NextResponse.json({ ok: true, member });
  } catch (err) {
    console.error("[api/admin/team/members/:id] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення";
    const status = /вкажіть|некоректн|не знайдено|Unique/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteTeamMember(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/team/members/:id] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка видалення" },
      { status: 500 },
    );
  }
}
