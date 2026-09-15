// Перевірка доступу до розділу Склад

import type { AuthContext, PermissionKey } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

const WAREHOUSE_SECTION: PermissionKey = "warehouseSection";

export async function requireWarehouseSection(
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
    if (mode === "edit" && auth.type !== "superadmin" && !canEdit(auth.permissions, WAREHOUSE_SECTION)) {
      return NextResponse.json({ error: "Немає права редагувати склад" }, { status: 403 });
    }
    if (!hasPermission(auth.permissions, WAREHOUSE_SECTION)) {
      return NextResponse.json({ error: "Немає доступу до розділу Склад" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireWarehouseSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
