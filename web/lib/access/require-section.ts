// Універсальна перевірка доступу до розділу за одним або кількома ключами permissions.

import type { AuthContext, PermissionKey } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

export async function requireAnySection(
  req: Request,
  keys: PermissionKey[],
  mode: "view" | "edit" = "view",
  deniedMessage = "Немає доступу до розділу",
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

    const canView = keys.some((key) => hasPermission(auth.permissions, key));
    if (!canView) {
      return NextResponse.json({ error: deniedMessage }, { status: 403 });
    }

    if (
      mode === "edit" &&
      auth.type !== "superadmin" &&
      !keys.some((key) => canEdit(auth.permissions, key))
    ) {
      return NextResponse.json({ error: "Немає права змінювати цей розділ" }, { status: 403 });
    }

    return auth;
  } catch (err) {
    console.error("[requireAnySection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
