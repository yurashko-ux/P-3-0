// Перевірка доступу до фінансового звіту (сесія AppUser або супер-адмін).

import type { AuthContext } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

export async function requireFinanceReportAccess(
  req: Request,
  mode: "view" | "edit",
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

    if (auth.type === "superadmin") {
      return auth;
    }

    if (mode === "edit" && !canEdit(auth.permissions, "financeReportSection")) {
      return NextResponse.json({ error: "Немає права редагувати фінансовий звіт" }, { status: 403 });
    }

    if (mode === "view" && !hasPermission(auth.permissions, "financeReportSection")) {
      return NextResponse.json({ error: "Немає доступу до фінансового звіту" }, { status: 403 });
    }

    return auth;
  } catch (err) {
    console.error("[requireFinanceReportAccess] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
