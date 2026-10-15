import { NextRequest, NextResponse } from "next/server";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { setTeamMemberTelegram } from "@/lib/team/store";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const member = await setTeamMemberTelegram(params.id, {
      telegramUsername: body.telegramUsername ?? null,
      telegramChatId: body.telegramChatId ?? null,
    });
    return NextResponse.json({ ok: true, member });
  } catch (err) {
    console.error("[api/admin/team/members/:id/telegram] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка збереження Telegram";
    const status = /не знайдено|некоректн/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
