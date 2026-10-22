// Емодзі першого вхідного повідомлення → джерело ліда.
// Кілька емодзі можуть вести в одне джерело. Уже отриманих лідів не переписуємо.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { listLeadSourceEmojis, setLeadSourceEmoji } from "@/lib/lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowed(req: NextRequest, needEdit: boolean): Promise<boolean> {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  const auth = await getAuthContext(req);
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  const level = auth.permissions.leadsSourcesSection || auth.permissions.statsSection;
  if (needEdit) return level === "edit";
  return level === "edit" || level === "view";
}

export async function GET(req: NextRequest) {
  if (!(await allowed(req, false))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const emojis = await listLeadSourceEmojis();
  return NextResponse.json({ ok: true, emojis });
}

export async function PATCH(req: NextRequest) {
  if (!(await allowed(req, true))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { emoji?: unknown; sourceCode?: unknown } | null;
  const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
  const sourceCode = typeof body?.sourceCode === "string" && body.sourceCode.trim() ? body.sourceCode.trim() : null;
  if (!emoji) {
    return NextResponse.json({ ok: false, error: "Потрібен емодзі" }, { status: 400 });
  }
  try {
    await setLeadSourceEmoji(emoji, sourceCode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/direct/lead-sources/emojis] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка збереження" },
      { status: 400 },
    );
  }
}
