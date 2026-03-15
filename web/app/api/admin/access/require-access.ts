// web/app/api/admin/access/require-access.ts
// Перевірка доступу до розділу Доступи (супер-адмін або accessSection)

import type { AuthContext } from "@/lib/auth-rbac";
import { getAuthContext } from "@/lib/auth-rbac";
import { NextResponse } from "next/server";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";

/** Повертає AuthContext або 401/403/500 Response. */
export async function requireAccessSection(req: Request): Promise<AuthContext | NextResponse> {
  try {
    // Preview-деплой Vercel — доступ як супер-адмін (без cookie)
    const host = req.headers.get("host") || "";
    if (isPreviewDeploymentHost(host)) {
      return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    const hasAccess =
      auth.type === "superadmin" || auth.permissions.accessSection === "edit" || auth.permissions.accessSection === "view";
    if (!hasAccess) {
      return NextResponse.json({ error: "Немає доступу до розділу Доступи" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireAccessSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 }
    );
  }
}
