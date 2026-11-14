// Доступ до розділу Бізнес-процеси: перегляд — view, створення й зміни — edit.

import type { AuthContext } from "@/lib/auth-rbac";
import { requireAnySection } from "@/lib/access/require-section";
import type { NextResponse } from "next/server";

export function requireBusinessProcessesSection(
  req: Request,
  mode: "view" | "edit" = "view",
): Promise<AuthContext | NextResponse> {
  return requireAnySection(req, ["businessProcessesSection"], mode, "Немає доступу до розділу Бізнес-процеси");
}

export function actorOf(auth: AuthContext): string {
  return auth.type === "user" ? auth.login : "superadmin";
}
