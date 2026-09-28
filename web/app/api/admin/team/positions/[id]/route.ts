import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { deleteTeamPosition, updateTeamPosition } from "@/lib/team/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> | { id: string } };

async function resolveId(ctx: Ctx): Promise<string> {
  const params = await Promise.resolve(ctx.params);
  return String(params?.id || "").trim();
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const id = await resolveId(ctx);
    if (!id) return NextResponse.json({ ok: false, error: "Немає id" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const position = await updateTeamPosition(id, body);
    return NextResponse.json({ ok: true, position });
  } catch (err) {
    console.error("[api/admin/team/positions/id] PATCH error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення";
    const status = /вкажіть|зайнят|не знайден/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const id = await resolveId(ctx);
    if (!id) return NextResponse.json({ ok: false, error: "Немає id" }, { status: 400 });
    await deleteTeamPosition(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/team/positions/id] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка видалення";
    const status = /призначено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
