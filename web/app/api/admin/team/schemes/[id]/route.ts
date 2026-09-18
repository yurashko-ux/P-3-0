import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { deleteTeamScheme, updateTeamScheme } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const scheme = await updateTeamScheme(params.id, body);
    return NextResponse.json({ ok: true, scheme });
  } catch (err) {
    console.error("[api/admin/team/schemes/:id] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення схеми";
    const status = /вкажіть|невідомий|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteTeamScheme(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/team/schemes/:id] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка видалення схеми";
    const status = /призначено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
