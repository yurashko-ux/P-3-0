import { NextResponse } from "next/server";
import type { AuthContext, PermissionKey } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";

const NOTION_SECTION: PermissionKey = "notionSection";

export async function requireNotionSection(
  req: Request,
  mode: "view" | "edit" = "view",
): Promise<AuthContext | NextResponse> {
  try {
    const host = req.headers.get("host") || "";
    const localWithoutPassword =
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")) &&
      !(process.env.ADMIN_PASS || "").trim();
    const auth = isPreviewDeploymentHost(host) || localWithoutPassword
      ? ({ type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } } as AuthContext)
      : await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    if (!hasPermission(auth.permissions, NOTION_SECTION)) {
      return NextResponse.json({ error: "Немає доступу до розділу Notion" }, { status: 403 });
    }
    if (mode === "edit" && !canEdit(auth.permissions, NOTION_SECTION)) {
      return NextResponse.json({ error: "Немає права змінювати розділ Notion" }, { status: 403 });
    }
    return auth;
  } catch (error) {
    console.error("[notion] помилка перевірки доступу", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
