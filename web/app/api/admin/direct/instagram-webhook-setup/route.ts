// Підпис сторінки на вебхуки Direct і дані, які треба вставити в застосунок Kresco.
// Токен сторінки у відповідь не потрапляє.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import {
  GRAPH,
  INSTAGRAM_GRAPH,
  INSTAGRAM_WEBHOOK_URL,
  graphCall,
  graphCallFailed,
  instagramAppSecret,
  instagramWebhookVerifyToken,
  loadInstagramPageToken,
} from "@/lib/instagram-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

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

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const verifyToken = instagramWebhookVerifyToken();
  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  const base = {
    callbackUrl: INSTAGRAM_WEBHOOK_URL,
    verifyToken,
    signatureCheck: Boolean(instagramAppSecret()),
    fields: ["messages", "message_echoes"],
  };

  if (!verifyToken || !userToken || !pageId) {
    const reason = !verifyToken
      ? "На сервері немає CRON_SECRET і INSTAGRAM_WEBHOOK_VERIFY_TOKEN, тож адресу Meta підтвердити не можна."
      : !userToken
        ? "На сервері немає INSTAGRAM_ACCESS_TOKEN."
        : "На сервері немає INSTAGRAM_PAGE_ID.";
    return NextResponse.json({
      ok: false,
      ...base,
      error: `Адреса: ${INSTAGRAM_WEBHOOK_URL}\nКод перевірки: ${verifyToken || "—"}\n\n${reason}`,
    });
  }

  const loaded = await loadInstagramPageToken(userToken, pageId);
  if (graphCallFailed(loaded)) {
    return NextResponse.json({
      ok: false,
      ...base,
      error: `Адреса: ${INSTAGRAM_WEBHOOK_URL}\nКод перевірки: ${verifyToken}\n\n${loaded.message}`,
      metaCode: loaded.code,
    });
  }

  if (!loaded.igId) {
    return NextResponse.json({
      ok: false,
      ...base,
      error: `Адреса: ${INSTAGRAM_WEBHOOK_URL}\nКод перевірки: ${verifyToken}\n\nСторінку видно, але id Instagram Meta не віддала.`,
    });
  }

  const attempts: string[] = [];
  const targets = [
    { base: INSTAGRAM_GRAPH, label: "instagram.com" },
    { base: GRAPH, label: "facebook.com" },
  ];
  let usedFields = "";
  for (const target of targets) {
    const subscribed = await graphCall(
      `${loaded.igId}/subscribed_apps`,
      loaded.pageToken,
      { subscribed_fields: "messages" },
      "POST",
      target.base,
    );
    if (graphCallFailed(subscribed)) {
      attempts.push(`${target.label}: ${subscribed.message}`);
      console.warn("[instagram-webhook-setup] Підписка не вдалась", target.label, subscribed.code, subscribed.message);
      continue;
    }
    usedFields = "messages";
    attempts.length = 0;
    break;
  }
  if (!usedFields) {
    return NextResponse.json({
      ok: false,
      ...base,
      instagramUsername: loaded.igUsername || null,
      error: `Адреса: ${INSTAGRAM_WEBHOOK_URL}\nКод перевірки: ${verifyToken}\n\n${attempts.join("\n")}`,
    });
  }

  const current = await graphCall(`${loaded.igId}/subscribed_apps`, loaded.pageToken, {}, "GET", INSTAGRAM_GRAPH);
  let subscribedFields: string[] = usedFields.split(",");
  if (!graphCallFailed(current) && Array.isArray(current.data.data)) {
    const apps = current.data.data as Array<{ subscribed_fields?: string[] }>;
    const fromMeta = apps.flatMap((app) => app.subscribed_fields || []);
    if (fromMeta.length) subscribedFields = fromMeta;
  }

  console.log("[instagram-webhook-setup] Instagram підписано", {
    username: loaded.igUsername || null,
    fields: subscribedFields,
  });
  return NextResponse.json({
    ok: true,
    ...base,
    fields: usedFields.split(","),
    instagramUsername: loaded.igUsername || null,
    subscribedFields,
  });
}
