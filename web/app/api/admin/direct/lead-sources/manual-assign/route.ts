// Ручне призначення джерела конкретному клієнту — для лідів БЕЗ ad_id (referral від Meta не прийшов).
// На відміну від /lead-sources/ad-ids — не груповий, пише leadAgency лише цьому одному клієнту.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { setClientLeadAgencyManually } from "@/lib/lead-sources";

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
  const body = (await req.json().catch(() => null)) as { clientId?: unknown; sourceCode?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const sourceCode = typeof body?.sourceCode === "string" && body.sourceCode.trim() ? body.sourceCode.trim() : null;
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Потрібен clientId" }, { status: 400 });
  }
  try {
    await setClientLeadAgencyManually(clientId, sourceCode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка збереження" },
      { status: 400 },
    );
  }
}
