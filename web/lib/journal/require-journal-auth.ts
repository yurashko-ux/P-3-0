// Перевірка доступу до розділу Журнал

import type { AuthContext, PermissionKey } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

const JOURNAL_SECTION: PermissionKey = "journalSection";

export async function requireJournalSection(
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
    if (mode === "edit" && auth.type !== "superadmin" && !canEdit(auth.permissions, JOURNAL_SECTION)) {
      return NextResponse.json({ error: "Немає права редагувати журнал" }, { status: 403 });
    }
    if (!hasPermission(auth.permissions, JOURNAL_SECTION)) {
      return NextResponse.json({ error: "Немає доступу до розділу Журнал" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireJournalSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 },
    );
  }
}
