// Приховування/показ джерела у списку вибору (ручне призначення джерела лідам без ad_id).
// Окремий ендпоінт від основного PATCH /lead-sources, бо доступний навіть якщо в джерела вже є ліди.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { setLeadSourceHidden } from "@/lib/lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowed(req: NextRequest): Promise<boolean> {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  const auth = await getAuthContext(req);
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  return auth.permissions.statsSection === "edit";
}

export async function PATCH(req: NextRequest) {
  if (!(await allowed(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown; hidden?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const hidden = body?.hidden === true;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Потрібен id джерела" }, { status: 400 });
  }
  try {
    await setLeadSourceHidden(id, hidden);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка збереження" },
      { status: 400 },
    );
  }
}
