// Перевірка доступу до розділу Дашборд (лише перегляд — редагувати тут нічого)

import type { AuthContext } from "@/lib/auth-rbac";
import { getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

export async function requireDashboardSection(req: Request): Promise<AuthContext | NextResponse> {
  try {
    const host = req.headers.get("host") || "";
    if (isPreviewDeploymentHost(host)) {
      return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    if (!hasPermission(auth.permissions, "dashboardSection")) {
      return NextResponse.json({ error: "Немає доступу до розділу Дашборд" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireDashboardSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
