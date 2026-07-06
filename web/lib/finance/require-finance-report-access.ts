// Перевірка доступу до фінансового звіту (сесія AppUser, супер-адмін або пароль фінзвіту).

import type { AuthContext } from "@/lib/auth-rbac";
import { canEdit, getAuthContext, hasPermission } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { canRevokeEncashmentConfirmation } from "@/lib/finance/encashment-confirmation";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import { NextResponse } from "next/server";

function getFinanceReportTokenFromCookieHeader(cookieHeader: string): string {
  const match = cookieHeader.match(/(?:^|;\s*)finance_report_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function hasValidFinanceReportToken(req: Request): boolean {
  const expected = process.env.FINANCE_REPORT_PASS?.trim() || "";
  if (!expected) return false;
  const cookieHeader = req.headers.get("cookie") || "";
  return getFinanceReportTokenFromCookieHeader(cookieHeader) === expected;
}

export async function resolveCanRevokeEncashment(params: {
  host: string;
  cookieHeader: string;
  auth: AuthContext | null;
}): Promise<boolean> {
  if (isPreviewDeploymentHost(params.host)) return true;
  if (params.auth && (await canRevokeEncashmentConfirmation(params.auth))) return true;
  // Вхід лише паролем фінзвіту (без логіну AppUser) — для тестового скасування.
  const pseudoReq = new Request("https://local/", {
    headers: { cookie: params.cookieHeader },
  });
  return hasValidFinanceReportToken(pseudoReq);
}

export async function requireFinanceReportAccess(
  req: Request,
  mode: "view" | "edit",
): Promise<AuthContext | NextResponse> {
  try {
    const host = req.headers.get("host") || "";
    if (isPreviewDeploymentHost(host)) {
      return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
    }

    if (hasValidFinanceReportToken(req)) {
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
