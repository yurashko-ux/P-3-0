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
const CONVERSATION_LIMIT = 6;
const MESSAGE_LIMIT = 12;
const PREVIEW_LIMIT = 25;
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
  participants?: { data?: Person[] };
  messages?: { data?: GraphMessage[] };
};

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

async function graphGet(
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string; code: number | null }> {
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
    const accounts = await graphGet("me/accounts", userToken, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "25",
    });
    if (!accounts.ok) {
      console.warn("[instagram-recent] Список сторінок не вдався", accounts.message);
      return NextResponse.json({ ok: false, error: accounts.message, metaCode: accounts.code });
    }

    const pages = Array.isArray(accounts.data.data) ? (accounts.data.data as Array<Record<string, unknown>>) : [];
    const page = pages.find((item) => String(item.id) === pageId) || null;
    const ig = (page?.instagram_business_account || null) as { id?: string; username?: string } | null;
    const pageToken = typeof page?.access_token === "string" ? page.access_token : "";
    const igId = ig?.id ? String(ig.id) : "";
    const igUsername = normalizeInstagram(ig?.username) || "";
    if (page) delete page.access_token;

    if (!page || !igId) {
      return NextResponse.json({
        ok: false,
        error: page
          ? "Сторінку видно, але Instagram Meta не віддала."
          : `Токен не бачить сторінку ${pageId}.`,
      });
    }

    const readToken = pageToken || userToken;
    const fields = `participants,messages.limit(${MESSAGE_LIMIT}){id,created_time,from,to,message}`;
    let conversations = await graphGet(`${pageId}/conversations`, readToken, {
      platform: "instagram",
      fields,
      limit: String(CONVERSATION_LIMIT),
    });
    if (!conversations.ok) {
      console.warn("[instagram-recent] Діалоги сторінки не вдалися, пробуємо id Instagram", conversations.message);
      conversations = await graphGet(`${igId}/conversations`, readToken, {
        platform: "instagram",
        fields,
        limit: String(CONVERSATION_LIMIT),
      });
    }
    if (!conversations.ok) {
      console.warn("[instagram-recent] Діалоги не вдалися", conversations.message);
      return NextResponse.json({ ok: false, error: conversations.message, metaCode: conversations.code });
    }

    const threads = Array.isArray(conversations.data.data)
      ? (conversations.data.data as Conversation[])
      : [];

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

    for (const thread of threads) {
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
        if (!message.id || !at || Number.isNaN(at.getTime())) continue;
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
      threads: threads.length,
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
      conversations: threads.length,
      messages: pulled.length,
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
