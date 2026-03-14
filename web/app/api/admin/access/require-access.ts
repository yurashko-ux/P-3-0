// web/app/api/admin/access/require-access.ts
// Перевірка доступу до розділу Доступи (супер-адмін або accessSection)

import type { AuthContext } from "@/lib/auth-rbac";
import { getAuthContext } from "@/lib/auth-rbac";
import { NextResponse } from "next/server";

/** Повертає AuthContext або 403 Response. */
export async function requireAccessSection(req: Request): Promise<AuthContext | NextResponse> {
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
}
