import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { createTeamScheme, ensureTypicalSchemes, listTeamSchemes } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTeamSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const schemes = await listTeamSchemes();
    return NextResponse.json({ ok: true, schemes });
  } catch (err) {
    console.error("[api/admin/team/schemes] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка схем" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.seedTypical === true) {
      const result = await ensureTypicalSchemes();
      return NextResponse.json({ ok: true, ...result });
    }
    const scheme = await createTeamScheme(body);
    return NextResponse.json({ ok: true, scheme });
  } catch (err) {
    console.error("[api/admin/team/schemes] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення схеми";
    const status = /вкажіть|невідомий/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
