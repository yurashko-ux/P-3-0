import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import {
  getDepositsByAltegioClientId,
  getDepositsForDirectClient,
} from "@/lib/deposits/store";

export const dynamic = "force-dynamic";

/** Баланс і історія завдатку: ?directClientId= або ?altegioClientId= */
export async function GET(req: NextRequest) {
  try {
    const host = req.headers.get("host") || "";
    let allowed = isPreviewDeploymentHost(host);
    if (!allowed) {
      const auth = await getAuthContext(req);
      if (!auth) {
        return NextResponse.json({ ok: false, error: "Не авторизовано" }, { status: 401 });
      }
      // Доступ з Direct або журналу
      allowed =
        auth.type === "superadmin" ||
        hasPermission(auth.permissions, "journalSection") ||
        hasPermission(auth.permissions, "finances") ||
        hasPermission(auth.permissions, "bankSection");
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Немає доступу" }, { status: 403 });
      }
    } else {
      void DEFAULT_PERMISSIONS;
    }

    const directClientId = String(req.nextUrl.searchParams.get("directClientId") || "").trim();
    const altegioClientId = Number(req.nextUrl.searchParams.get("altegioClientId") || 0);

    if (directClientId) {
      const data = await getDepositsForDirectClient(directClientId);
      return NextResponse.json({ ok: true, ...data });
    }
    if (altegioClientId > 0) {
      const data = await getDepositsByAltegioClientId(altegioClientId);
      return NextResponse.json({ ok: true, ...data });
    }
    return NextResponse.json(
      { ok: false, error: "Вкажіть directClientId або altegioClientId" },
      { status: 400 },
    );
  } catch (err) {
    console.error("[api/admin/deposits] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка завдатку" },
      { status: 500 },
    );
  }
}
