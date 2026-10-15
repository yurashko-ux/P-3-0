// Тиха перевірка: чи бачить токен сторінку Facebook і прив’язаний Instagram.
// Токен у відповідь і в логи не потрапляє. Повідомлень нікому не надсилаємо.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPECTED_USERNAME = "homebeauty.lviv";

function isAuthorized(
  req: NextRequest,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
): boolean {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  return auth.permissions.debugSection === "edit" || auth.permissions.debugSection === "view";
}

function sanitize(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/gi, "access_token=***")
    .replace(/EAA[A-Za-z0-9]+/g, "***");
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();

  if (!token || !pageId) {
    console.warn("[instagram-token-check] Немає змінних", {
      hasToken: Boolean(token),
      hasPageId: Boolean(pageId),
    });
    return NextResponse.json({
      ok: false,
      seesPage: false,
      seesInstagram: false,
      error: !token && !pageId
        ? "На сервері немає INSTAGRAM_ACCESS_TOKEN і INSTAGRAM_PAGE_ID."
        : !token
          ? "На сервері немає INSTAGRAM_ACCESS_TOKEN."
          : "На сервері немає INSTAGRAM_PAGE_ID.",
    });
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}`);
  url.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  url.searchParams.set("access_token", token);

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    const raw = await response.text();
    let data: {
      id?: string;
      name?: string;
      instagram_business_account?: { id?: string; username?: string };
      error?: { message?: string; code?: number; error_subcode?: number };
    } = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!response.ok || data.error) {
      const message = sanitize(data.error?.message || raw.slice(0, 300) || `HTTP ${response.status}`);
      console.warn("[instagram-token-check] Meta відмовила", {
        status: response.status,
        code: data.error?.code ?? null,
        message,
      });
      return NextResponse.json({
        ok: false,
        seesPage: false,
        seesInstagram: false,
        pageId,
        error: message,
        metaCode: data.error?.code ?? null,
      });
    }

    const username = (data.instagram_business_account?.username || "").replace(/^@/, "");
    const seesInstagram = Boolean(data.instagram_business_account?.id);
    console.log("[instagram-token-check] Відповідь Meta", {
      seesPage: Boolean(data.id),
      pageName: data.name || null,
      seesInstagram,
      username: username || null,
      matchesSalon: username.toLowerCase() === EXPECTED_USERNAME,
    });

    return NextResponse.json({
      ok: seesInstagram,
      seesPage: Boolean(data.id),
      pageId: data.id || pageId,
      pageName: data.name || null,
      seesInstagram,
      instagramUsername: username || null,
      matchesSalon: username.toLowerCase() === EXPECTED_USERNAME,
      error: seesInstagram ? null : "Сторінку видно, але прив’язаний Instagram Meta не віддала.",
    });
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : String(error));
    console.error("[instagram-token-check] Запит не вдався", message);
    return NextResponse.json(
      { ok: false, seesPage: false, seesInstagram: false, error: message },
      { status: 500 },
    );
  }
}
