// ad_id оголошень Meta (referral з вебхука Instagram) → джерело ліда.
// Прив'язка один раз на оголошення — надалі всі ліди з нього визначаються автоматично.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { listLeadAdIds, setLeadAdIdSource } from "@/lib/lead-sources";

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
  const adIds = await listLeadAdIds();
  return NextResponse.json({ ok: true, adIds });
}

export async function PATCH(req: NextRequest) {
  if (!(await allowed(req, true))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { adId?: unknown; sourceCode?: unknown } | null;
  const adId = typeof body?.adId === "string" ? body.adId.trim() : "";
  const sourceCode = typeof body?.sourceCode === "string" && body.sourceCode.trim() ? body.sourceCode.trim() : null;
  if (!adId) {
    return NextResponse.json({ ok: false, error: "Потрібен ad_id" }, { status: 400 });
  }
  try {
    const result = await setLeadAdIdSource(adId, sourceCode);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/admin/direct/lead-sources/ad-ids] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка збереження" },
      { status: 400 },
    );
  }
}
