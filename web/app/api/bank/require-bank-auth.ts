// web/app/api/bank/require-bank-auth.ts
// Перевірка доступу до розділу Банк

import type { AuthContext } from "@/lib/auth-rbac";
import { getAuthContext, hasPermission } from "@/lib/auth-rbac";
import type { PermissionKey } from "@/lib/auth-rbac";
import { NextResponse } from "next/server";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";

const BANK_SECTION: PermissionKey = "bankSection";

export async function requireBankSection(req: Request): Promise<AuthContext | NextResponse> {
  try {
    const host = req.headers.get("host") || "";
    if (isPreviewDeploymentHost(host)) {
      return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    if (!hasPermission(auth.permissions, BANK_SECTION)) {
      return NextResponse.json({ error: "Немає доступу до розділу Банк" }, { status: 403 });
    }
    return auth;
  } catch (err) {
    console.error("[requireBankSection] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка перевірки доступу" },
      { status: 500 }
    );
  }
}
