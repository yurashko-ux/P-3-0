// Тест маркетингового звіту зірочки за вчора в групу Таргет (кнопка #103 AdminToolsModal).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getPreviousKyivDay } from "@/lib/direct-stats-config";
import { sendMarketingDayReport } from "@/lib/reports/marketing-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const auth = isPreviewDeploymentHost(host) ? { type: "superadmin" as const } : await getAuthContext(req);
  const allowed =
    isPreviewDeploymentHost(host) ||
    (auth &&
      (auth.type === "superadmin" ||
        auth.permissions.debugSection === "edit" ||
        auth.permissions.debugSection === "view"));
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kyivDay = getPreviousKyivDay();
    const sent = await sendMarketingDayReport(kyivDay);
    return NextResponse.json({ ok: true, ...sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/admin/reports/test-marketing]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
