// Вебхук Instagram Direct: перевірка адреси, журнал останніх подій, токен сторінки.
// Токени в логи і у відповіді клієнту не потрапляють.

import { createHmac, timingSafeEqual } from "crypto";
import { kvRead, kvWrite } from "@/lib/kv";

export const INSTAGRAM_WEBHOOK_PATH = "/api/instagram/webhook";
export const INSTAGRAM_WEBHOOK_URL = `https://p-3-0.vercel.app${INSTAGRAM_WEBHOOK_PATH}`;
export const INSTAGRAM_WEBHOOK_LOG_KEY = "instagram:webhook:log";
const LOG_LIMIT = 30;
const GRAPH = "https://graph.facebook.com/v21.0";

export type InstagramWebhookEvent = {
  receivedAt: string;
  direction: "incoming" | "outgoing";
  text: string;
  messageId: string | null;
  senderId: string | null;
  recipientId: string | null;
  username: string | null;
  name: string | null;
  status: string;
};

export function sanitizeMeta(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/gi, "access_token=***")
    .replace(/EAA[A-Za-z0-9]+/g, "***");
}

export function instagramWebhookVerifyToken(): string {
  const explicit = (process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (explicit) return explicit;
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return "";
  return createHmac("sha256", secret).update("instagram-webhook-verify").digest("hex").slice(0, 32);
}

export function instagramAppSecret(): string {
  return (
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    process.env.META_APP_SECRET ||
    ""
  ).trim();
}

export function instagramSignatureOk(rawBody: string, header: string | null): boolean {
  const secret = instagramAppSecret();
  if (!secret || !header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function rememberInstagramWebhook(event: InstagramWebhookEvent): Promise<void> {
  await kvWrite.lpush(INSTAGRAM_WEBHOOK_LOG_KEY, JSON.stringify(event));
  await kvWrite.ltrim(INSTAGRAM_WEBHOOK_LOG_KEY, 0, LOG_LIMIT - 1);
}

export async function readInstagramWebhooks(): Promise<InstagramWebhookEvent[]> {
  const rows = await kvRead.lrange(INSTAGRAM_WEBHOOK_LOG_KEY, 0, LOG_LIMIT - 1);
  const events: InstagramWebhookEvent[] = [];
  for (const row of rows) {
    if (typeof row !== "string" || !row.trim()) continue;
    try {
      events.push(JSON.parse(row) as InstagramWebhookEvent);
    } catch {
      // пошкоджений рядок журналу пропускаємо
    }
  }
  return events;
}

type GraphOk = { ok: true; data: Record<string, unknown> };
type GraphFail = { ok: false; message: string; code: number | null };
export type GraphCall = GraphOk | GraphFail;

export function graphCallFailed<T extends { ok: true }>(result: T | GraphFail): result is GraphFail {
  return result.ok === false;
}

export async function graphCall(
  path: string,
  token: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<GraphCall> {
  const url = new URL(`${GRAPH}/${path}`);
  const body = new URLSearchParams();
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("access_token", token);
  } else {
    for (const [key, value] of Object.entries(params)) body.set(key, value);
    body.set("access_token", token);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? body.toString() : undefined,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      message: aborted ? "Timeout" : sanitizeMeta(error instanceof Error ? error.message : String(error)),
      code: aborted ? -2 : null,
    };
  }

  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  const error = data.error as { message?: string; code?: number } | undefined;
  if (!response.ok || error) {
    return {
      ok: false,
      message: sanitizeMeta(error?.message || raw.slice(0, 300) || `HTTP ${response.status}`),
      code: error?.code ?? null,
    };
  }
  return { ok: true, data };
}

export async function loadInstagramPageToken(userToken: string, pageId: string): Promise<
  | { ok: true; pageToken: string; igId: string; igUsername: string }
  | GraphFail
> {
  const accounts = await graphCall("me/accounts", userToken, {
    fields: "id,access_token,instagram_business_account{id,username}",
    limit: "5",
  });
  if (graphCallFailed(accounts)) return accounts;
  const pages = Array.isArray(accounts.data.data) ? (accounts.data.data as Array<Record<string, unknown>>) : [];
  const page = pages.find((item) => String(item.id) === pageId);
  const pageToken = typeof page?.access_token === "string" ? page.access_token : "";
  const ig = (page?.instagram_business_account || null) as { id?: string; username?: string } | null;
  if (page) delete page.access_token;
  if (!pageToken) {
    return { ok: false, message: "Meta не повернула токен сторінки.", code: null };
  }
  return {
    ok: true,
    pageToken,
    igId: ig?.id ? String(ig.id) : "",
    igUsername: (ig?.username || "").replace(/^@/, ""),
  };
}
