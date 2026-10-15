// Недавні Direct з Instagram: показати вхідні і вихідні, дописати в історію лише нові.
// Повідомлення, які вже є з ManyChat (той самий текст і час), не дублюємо.
// Токен і page access token у відповідь і в логи не потрапляють. Нічого не надсилаємо.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { prisma } from "@/lib/prisma";
import { normalizeInstagram } from "@/lib/normalize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v21.0";
const CONVERSATION_LIMIT = 20;
const MESSAGE_LIMIT = 25;
const PREVIEW_LIMIT = 25;
const LOOKBACK_DAYS = 3;
const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

type Person = { id?: string; username?: string; name?: string };
type GraphMessage = {
  id?: string;
  created_time?: string;
  message?: string;
  from?: Person;
  to?: { data?: Person[] };
  attachments?: { data?: unknown[] };
};
type Conversation = {
  id?: string;
  updated_time?: string;
  participants?: { data?: Person[] };
  messages?: { data?: GraphMessage[] };
};
type Attempt = { step: string; code: number | null; message: string };

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

function normText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMediaText(value: string): boolean {
  const text = normText(value);
  return !text || text.includes("медіа") || text === "(повідомлення з вебхука)" || text === "(без тексту)";
}

function kyivStamp(date: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function asPerson(value: unknown): Person | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Person;
  return {
    id: row.id ? String(row.id) : undefined,
    username: typeof row.username === "string" ? row.username : undefined,
    name: typeof row.name === "string" ? row.name : undefined,
  };
}

type GraphOk = { ok: true; data: Record<string, unknown> };
type GraphFail = { ok: false; message: string; code: number | null };
type GraphResult = GraphOk | GraphFail;

function graphFailed(result: GraphResult): result is GraphFail {
  return result.ok === false;
}

async function graphGet(
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<GraphResult> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const response = await fetch(url.toString(), { cache: "no-store" });
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
      message: sanitize(error?.message || raw.slice(0, 300) || `HTTP ${response.status}`),
      code: error?.code ?? null,
    };
  }
  return { ok: true, data };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  if (!userToken || !pageId) {
    return NextResponse.json({
      ok: false,
      error: !userToken
        ? "На сервері немає INSTAGRAM_ACCESS_TOKEN."
        : "На сервері немає INSTAGRAM_PAGE_ID.",
    });
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const attempts: Attempt[] = [];
    const accounts = await graphGet("me/accounts", userToken, {
      fields: "id,name,instagram_business_account{id,username}",
      limit: "25",
    });
    if (graphFailed(accounts)) {
      console.warn("[instagram-recent] Список сторінок не вдався", accounts.message);
      return NextResponse.json({ ok: false, error: accounts.message, metaCode: accounts.code });
    }

    const pages = Array.isArray(accounts.data.data) ? (accounts.data.data as Array<Record<string, unknown>>) : [];
    const page = pages.find((item) => String(item.id) === pageId) || null;
    const ig = (page?.instagram_business_account || null) as { id?: string; username?: string } | null;
    const igId = ig?.id ? String(ig.id) : "";
    const igUsername = normalizeInstagram(ig?.username) || "";

    if (!page || !igId) {
      return NextResponse.json({
        ok: false,
        error: page
          ? "Сторінку видно, але Instagram Meta не віддала."
          : `Токен не бачить сторінку ${pageId}.`,
      });
    }

    const listParams = {
      platform: "instagram",
      fields: "id,updated_time,participants",
      limit: String(CONVERSATION_LIMIT),
    };
    const listAttempts: Array<{ step: string; path: string; token: string }> = [
      { step: "діалоги сторінки", path: `${pageId}/conversations`, token: userToken },
      { step: "діалоги Instagram", path: `${igId}/conversations`, token: userToken },
    ];

    let threads: Conversation[] | null = null;
    let sawEmptyList = false;
    let readToken = userToken;
    for (const attempt of listAttempts) {
      const listed = await graphGet(attempt.path, attempt.token, listParams);
      if (graphFailed(listed)) {
        attempts.push({ step: attempt.step, code: listed.code, message: listed.message });
        console.warn("[instagram-recent] Список діалогів не вдався", attempt.step, listed.code, listed.message);
        continue;
      }
      const rows = Array.isArray(listed.data.data) ? (listed.data.data as Conversation[]) : [];
      if (rows.length === 0) {
        sawEmptyList = true;
        continue;
      }
      threads = rows;
      readToken = attempt.token;
      break;
    }

    if (!threads) {
      const pageTokenResult = await graphGet("me/accounts", userToken, {
        fields: "id,access_token",
        limit: "25",
      });
      let pageToken = "";
      if (graphFailed(pageTokenResult)) {
        attempts.push({
          step: "токен сторінки",
          code: pageTokenResult.code,
          message: pageTokenResult.message,
        });
      } else {
        const tokenPages = Array.isArray(pageTokenResult.data.data)
          ? (pageTokenResult.data.data as Array<Record<string, unknown>>)
          : [];
        const tokenPage = tokenPages.find((item) => String(item.id) === pageId);
        pageToken = typeof tokenPage?.access_token === "string" ? tokenPage.access_token : "";
        if (tokenPage) delete tokenPage.access_token;
      }
      if (pageToken) {
        const listed = await graphGet(`${pageId}/conversations`, pageToken, listParams);
        if (graphFailed(listed)) {
          attempts.push({ step: "діалоги токеном сторінки", code: listed.code, message: listed.message });
        } else {
          const rows = Array.isArray(listed.data.data) ? (listed.data.data as Conversation[]) : [];
          if (rows.length === 0) sawEmptyList = true;
          else {
            threads = rows;
            readToken = pageToken;
          }
        }
      }
    }

    if (!threads && sawEmptyList) threads = [];

    if (!threads) {
      const detail = attempts
        .map((attempt) => `${attempt.step}: ${attempt.message}`)
        .join("\n");
      return NextResponse.json({
        ok: false,
        error: `Meta не дала прочитати діалоги за ${LOOKBACK_DAYS} дні.\n${detail}`,
        attempts,
        metaCode: attempts[0]?.code ?? null,
      });
    }

    const recentThreads = threads
      .filter((thread) => {
        if (!thread.updated_time) return true;
        const updated = new Date(thread.updated_time);
        return !Number.isNaN(updated.getTime()) && updated.getTime() >= since.getTime();
      })
      .slice(0, 15);

    let messageFailures = 0;
    let messageTargets = 0;
    for (const thread of recentThreads) {
      if (!thread.id) continue;
      messageTargets += 1;
      const listedMessages = await graphGet(`${thread.id}/messages`, readToken, {
        fields: "id,created_time,from,to,message",
        limit: String(MESSAGE_LIMIT),
      });
      if (graphFailed(listedMessages)) {
        messageFailures += 1;
        if (messageFailures === 1) {
          attempts.push({
            step: "повідомлення діалогу",
            code: listedMessages.code,
            message: listedMessages.message,
          });
          console.warn("[instagram-recent] Повідомлення діалогу не вдалися", listedMessages.code, listedMessages.message);
        }
        thread.messages = { data: [] };
        continue;
      }
      const rows = Array.isArray(listedMessages.data.data) ? (listedMessages.data.data as GraphMessage[]) : [];
      thread.messages = {
        data: rows.filter((message) => {
          if (!message.created_time) return false;
          const at = new Date(message.created_time);
          return !Number.isNaN(at.getTime()) && at.getTime() >= since.getTime();
        }),
      };
    }

    if (messageTargets > 0 && messageFailures === messageTargets) {
      const detail = attempts.map((attempt) => `${attempt.step}: ${attempt.message}`).join("\n");
      return NextResponse.json({
        ok: false,
        error: `Діалоги є, але повідомлення за ${LOOKBACK_DAYS} дні Meta не віддала.\n${detail}`,
        attempts,
        metaCode: attempts[attempts.length - 1]?.code ?? null,
      });
    }

    type Pulled = {
      graphId: string;
      conversationId: string;
      at: Date;
      direction: "incoming" | "outgoing";
      text: string;
      username: string | null;
      name: string | null;
    };
    const pulled: Pulled[] = [];

    for (const thread of recentThreads) {
      const people = (thread.participants?.data || []).map((person) => asPerson(person)).filter(Boolean) as Person[];
      const messages = thread.messages?.data || [];
      for (const message of messages) {
        const from = asPerson(message.from);
        const toPeople = (message.to?.data || []).map((person) => asPerson(person)).filter(Boolean) as Person[];
        const fromUsername = normalizeInstagram(from?.username);
        const outgoing =
          (Boolean(igId) && from?.id === igId) || (Boolean(igUsername) && fromUsername === igUsername);
        const others = [...people, ...toPeople, ...(outgoing ? [] : from ? [from] : [])].filter((person) => {
          const username = normalizeInstagram(person.username);
          if (person.id && person.id === igId) return false;
          if (username && username === igUsername) return false;
          return true;
        });
        const clientPerson =
          others.find((person) => normalizeInstagram(person.username)) || others[0] || null;
        const text = (message.message || "").trim() || (message.attachments?.data?.length ? "📷 медіа" : "(без тексту)");
        const at = message.created_time ? new Date(message.created_time) : null;
        if (!message.id || !at || Number.isNaN(at.getTime()) || at.getTime() < since.getTime()) continue;
        pulled.push({
          graphId: String(message.id),
          conversationId: thread.id ? String(thread.id) : "",
          at,
          direction: outgoing ? "outgoing" : "incoming",
          text: text.slice(0, 4000),
          username: normalizeInstagram(clientPerson?.username),
          name: clientPerson?.name?.trim() || null,
        });
      }
    }

    pulled.sort((a, b) => b.at.getTime() - a.at.getTime());

    const usernames = [...new Set(pulled.map((item) => item.username).filter(Boolean))] as string[];
    const clients = usernames.length
      ? await prisma.directClient.findMany({
          where: { instagramUsername: { in: usernames } },
          select: { id: true, instagramUsername: true, firstName: true, lastName: true, lastMessageAt: true },
        })
      : [];
    const clientByUsername = new Map(clients.map((client) => [client.instagramUsername, client]));
    const clientIds = clients.map((client) => client.id);
    const existing = clientIds.length
      ? await prisma.directMessage.findMany({
          where: { clientId: { in: clientIds } },
          select: { clientId: true, messageId: true, text: true, direction: true, receivedAt: true, source: true },
          orderBy: { receivedAt: "desc" },
          take: 4000,
        })
      : [];

    const knownIds = new Set(existing.map((row) => row.messageId).filter(Boolean) as string[]);
    let incoming = 0;
    let outgoing = 0;
    let saved = 0;
    let duplicates = 0;
    let unmatched = 0;
    const preview: Array<{
      time: string;
      direction: "incoming" | "outgoing";
      username: string | null;
      name: string | null;
      text: string;
      status: string;
    }> = [];
    const newestSaved = new Map<string, Date>();

    for (const item of pulled) {
      if (item.direction === "incoming") incoming += 1;
      else outgoing += 1;

      const client = item.username ? clientByUsername.get(item.username) : undefined;
      let status = "немає в таблиці клієнтів";
      if (!client) {
        unmatched += 1;
      } else if (knownIds.has(item.graphId)) {
        duplicates += 1;
        status = "вже забрано раніше";
      } else {
        const same = existing.find((row) => {
          if (row.clientId !== client.id || row.direction !== item.direction) return false;
          if (Math.abs(row.receivedAt.getTime() - item.at.getTime()) > DEDUP_WINDOW_MS) return false;
          const left = normText(row.text || "");
          const right = normText(item.text);
          if (left === right) return true;
          return isMediaText(left) && isMediaText(right);
        });
        if (same) {
          duplicates += 1;
          status = same.source === "manychat" ? "вже є з ManyChat" : "вже є в історії";
        } else {
          await prisma.directMessage.create({
            data: {
              clientId: client.id,
              direction: item.direction,
              text: item.text,
              messageId: item.graphId,
              source: "instagram_graph",
              receivedAt: item.at,
              rawData: JSON.stringify({
                conversationId: item.conversationId,
                username: item.username,
              }).slice(0, 2000),
            },
          });
          knownIds.add(item.graphId);
          existing.push({
            clientId: client.id,
            messageId: item.graphId,
            text: item.text,
            direction: item.direction,
            receivedAt: item.at,
            source: "instagram_graph",
          });
          const prev = newestSaved.get(client.id);
          if (!prev || item.at > prev) newestSaved.set(client.id, item.at);
          saved += 1;
          status = "записано в історію";
        }
      }

      if (preview.length < PREVIEW_LIMIT) {
        preview.push({
          time: kyivStamp(item.at),
          direction: item.direction,
          username: item.username,
          name: item.name,
          text: item.text.length > 180 ? `${item.text.slice(0, 180)}…` : item.text,
          status,
        });
      }
    }

    for (const [clientId, at] of newestSaved) {
      const client = clients.find((row) => row.id === clientId);
      if (client && (!client.lastMessageAt || at > client.lastMessageAt)) {
        await prisma.directClient.update({
          where: { id: clientId },
          data: { lastMessageAt: at },
        });
      }
    }

    console.log("[instagram-recent] Готово", {
      threads: recentThreads.length,
      messages: pulled.length,
      incoming,
      outgoing,
      saved,
      duplicates,
      unmatched,
    });

    return NextResponse.json({
      ok: true,
      instagramUsername: igUsername || null,
      conversations: recentThreads.length,
      messages: pulled.length,
      lookbackDays: LOOKBACK_DAYS,
      incoming,
      outgoing,
      saved,
      duplicates,
      unmatched,
      preview,
    });
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : String(error));
    console.error("[instagram-recent] Запит не вдався", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
