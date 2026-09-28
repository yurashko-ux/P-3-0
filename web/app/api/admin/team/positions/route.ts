import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import {
  createTeamPosition,
  listTeamPositions,
  setPositionPaySchemes,
} from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTeamSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
    const positions = await listTeamPositions({ includeInactive });
    return NextResponse.json({ ok: true, positions });
  } catch (err) {
    console.error("[api/admin/team/positions] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка посад" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "setPaySchemes") {
      const result = await setPositionPaySchemes({
        positionId: body.positionId,
        schemeIds: body.schemeIds,
        effectiveFrom: body.effectiveFrom,
        note: body.note,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const position = await createTeamPosition(body);
    return NextResponse.json({ ok: true, position });
  } catch (err) {
    console.error("[api/admin/team/positions] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення посади";
    const status = /вкажіть|зайнят|не знайден/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
