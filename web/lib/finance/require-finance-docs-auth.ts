// Перевірка доступу до розділу Фінанси (документи)

import type { AuthContext, PermissionKey } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

const FINANCE_DOCS: PermissionKey = "financeDocsSection";

export async function requireFinanceDocsSection(
  req: Request,
  mode: "view" | "edit" = "view",
): Promise<AuthContext | NextResponse> {
  try {
    const host = req.headers.get("host") || "";
    if (isPreviewDeploymentHost(host)) {
      return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    // Fallback: хто має фінзвіт — теж бачить документи
    const ok =
      hasPermission(auth.permissions, FINANCE_DOCS) ||
      hasPermission(auth.permissions, "financeReportSection");
    if (!ok) {
      return NextResponse.json({ error: "Немає доступу до фінансових документів" }, { status: 403 });
    }
    if (
      mode === "edit" &&
      auth.type !== "superadmin" &&
      !canEdit(auth.permissions, FINANCE_DOCS) &&
      !canEdit(auth.permissions, "financeReportSection")
    ) {
      return NextResponse.json({ error: "Немає права редагувати фінанси" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireFinanceDocsSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
