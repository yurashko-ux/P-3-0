import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { createTeamMember, listLinkOptions, listTeamMembers } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTeamSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const [members, links] = await Promise.all([listTeamMembers(), listLinkOptions()]);
    return NextResponse.json({ ok: true, members, ...links });
  } catch (err) {
    console.error("[api/admin/team/members] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка команди" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const member = await createTeamMember(body);
    return NextResponse.json({ ok: true, member });
  } catch (err) {
    console.error("[api/admin/team/members] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення";
    const status = /вкажіть|некоректн|Unique|унікальн/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
