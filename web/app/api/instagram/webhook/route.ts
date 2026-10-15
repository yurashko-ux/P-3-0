// Вхід Meta: нове повідомлення Direct або луна відповіді салону з застосунку Instagram.
// Стару переписку не читаємо. Токен у відповідь не потрапляє.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeInstagram } from "@/lib/normalize";
import {
  graphCall,
  graphCallFailed,
  instagramAppSecret,
  instagramSignatureOk,
  instagramWebhookVerifyToken,
  loadInstagramPageToken,
  rememberInstagramWebhook,
  sanitizeMeta,
  type InstagramWebhookEvent,
} from "@/lib/instagram-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

type MessagingItem = {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_self?: boolean;
    attachments?: unknown[];
  };
};

function normText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function messageTime(value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return messageTime(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function normalizeItem(raw: unknown): MessagingItem | null {
  const row = asRecord(raw);
  if (!row) return null;
  const message = asRecord(row.message) || row;
  const text = typeof message.text === "string" ? message.text : typeof row.text === "string" ? row.text : undefined;
  const mid = message.mid || message.id || row.mid || row.id;
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : Array.isArray(row.attachments)
      ? row.attachments
      : undefined;
  const hasMessage = Boolean(text || mid || attachments?.length || message.is_echo || message.is_self);
  if (!hasMessage) return null;
  const sender = asRecord(row.sender) || asRecord(row.from);
  const recipient = asRecord(row.recipient) || asRecord(row.to);
  return {
    sender: sender
      ? {
          id: sender.id ? String(sender.id) : undefined,
          username: typeof sender.username === "string" ? sender.username : undefined,
        }
      : undefined,
    recipient: recipient?.id ? { id: String(recipient.id) } : undefined,
    timestamp: (row.timestamp ?? message.timestamp) as number | string | undefined,
    message: {
      mid: mid ? String(mid) : undefined,
      text,
      is_echo: Boolean(message.is_echo || row.is_echo),
      is_self: Boolean(message.is_self || row.is_self),
      attachments,
    },
  };
}

function collectItems(body: unknown): Array<{ item: MessagingItem; entryId: string }> {
  const roots = Array.isArray(body) ? body : [body];
  const found: Array<{ item: MessagingItem; entryId: string }> = [];
  for (const root of roots) {
    const rootRow = asRecord(root);
    if (!rootRow) continue;
    const entries = Array.isArray(rootRow.entry) ? rootRow.entry : [rootRow];
    for (const entry of entries) {
      const entryRow = asRecord(entry);
      if (!entryRow) continue;
      const entryId = entryRow.id ? String(entryRow.id) : "";
      const bags: unknown[] = [];
      if (Array.isArray(entryRow.messaging)) bags.push(...entryRow.messaging);
      if (Array.isArray(entryRow.changes)) {
        for (const change of entryRow.changes) {
          const changeRow = asRecord(change);
          if (changeRow?.value) bags.push(changeRow.value);
        }
      }
      for (const bag of bags) {
        const item = normalizeItem(bag);
        if (item) found.push({ item, entryId });
      }
    }
  }
  return found;
}

function looseTexts(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || found.length >= 3 || value == null) return found;
  if (typeof value === "string") return found;
  if (Array.isArray(value)) {
    for (const item of value) looseTexts(item, found, depth + 1);
    return found;
  }
  const row = asRecord(value);
  if (!row) return found;
  if (typeof row.text === "string" && row.text.trim()) found.push(row.text.trim().slice(0, 200));
  for (const [key, nested] of Object.entries(row)) {
    if (key === "text" || key === "access_token") continue;
    looseTexts(nested, found, depth + 1);
  }
  return found;
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expected = instagramWebhookVerifyToken();

  if (mode === "subscribe" && expected && token === expected && challenge) {
    console.log("[instagram/webhook] Meta підтвердила адресу");
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[instagram/webhook] Підтвердження адреси не зійшлося", {
    mode,
    hasToken: Boolean(token),
    hasExpected: Boolean(expected),
  });
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = instagramAppSecret();
  if (secret && !instagramSignatureOk(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn("[instagram/webhook] Підпис Meta не зійшовся");
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    await rememberInstagramWebhook({
      receivedAt: new Date().toISOString(),
      direction: "incoming",
      text: sanitizeMeta(raw).slice(0, 300),
      messageId: null,
      senderId: null,
      recipientId: null,
      username: null,
      name: null,
      status: "прийшло, але це не JSON",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  let igId = "";
  let igUsername = "";
  let pageToken = "";
  if (userToken && pageId) {
    const loaded = await loadInstagramPageToken(userToken, pageId);
    if (!graphCallFailed(loaded)) {
      igId = loaded.igId;
      igUsername = loaded.igUsername;
      pageToken = loaded.pageToken;
    }
  }

  const items = collectItems(body);
  for (const { item, entryId } of items) {
    try {
      await acceptMessage({
        item,
        entryId,
        igId,
        igUsername,
        pageId,
        pageToken,
      });
    } catch (error) {
      console.error("[instagram/webhook] Повідомлення не збереглось", sanitizeMeta(error instanceof Error ? error.message : String(error)));
    }
  }

  if (items.length === 0) {
    const root = asRecord(body);
    const entries = Array.isArray(root?.entry) ? root.entry : [];
    const fields = entries.flatMap((entry) => {
      const row = asRecord(entry);
      if (!row || !Array.isArray(row.changes)) return [];
      return row.changes.map((change) => asRecord(change)?.field).filter((field): field is string => typeof field === "string");
    });
    const texts = looseTexts(body);
    await rememberInstagramWebhook({
      receivedAt: new Date().toISOString(),
      direction: "incoming",
      text: [
        `object=${typeof root?.object === "string" ? root.object : "—"}`,
        `записів=${entries.length}`,
        `поля=${fields.join(", ") || "немає"}`,
        texts.length ? `текст=${texts.join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join(", "),
      messageId: null,
      senderId: null,
      recipientId: null,
      username: null,
      name: null,
      status: "запит прийшов, повідомлення в ньому не розпізнано",
    }).catch((error) => {
      console.warn("[instagram/webhook] Журнал не записався", sanitizeMeta(error instanceof Error ? error.message : String(error)));
    });
  }

  return NextResponse.json({ ok: true });
}

async function usernameFromLatestThread(
  pageId: string,
  pageToken: string,
  messageId: string,
  salonUsername: string,
): Promise<string | null> {
  const salon = normalizeInstagram(salonUsername);
  const listed = await graphCall(`${pageId}/conversations`, pageToken, {
    platform: "instagram",
    fields: "id",
    limit: "1",
  });
  if (graphCallFailed(listed)) {
    console.warn("[instagram/webhook] Діалог для ніка не відкрився", listed.message);
    return null;
  }
  const conversations = Array.isArray(listed.data.data) ? listed.data.data : [];
  const first = asRecord(conversations[0]);
  const conversationId = first?.id ? String(first.id) : "";
  if (!conversationId) return null;

  const messages = await graphCall(`${conversationId}/messages`, pageToken, {
    fields: "id,from,message",
    limit: "8",
  });
  if (graphCallFailed(messages)) {
    console.warn("[instagram/webhook] Повідомлення діалогу для ніка не відкрились", messages.message);
    return null;
  }
  const rows = Array.isArray(messages.data.data) ? messages.data.data : [];
  let fallback: string | null = null;
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const from = asRecord(record.from);
    const username = normalizeInstagram(typeof from?.username === "string" ? from.username : null);
    if (!username || username === salon) continue;
    if (messageId && String(record.id || "") === messageId) return username;
    if (!fallback) fallback = username;
  }
  return fallback;
}

async function acceptMessage(input: {
  item: MessagingItem;
  entryId: string;
  igId: string;
  igUsername: string;
  pageId: string;
  pageToken: string;
}): Promise<void> {
  const senderId = input.item.sender?.id ? String(input.item.sender.id) : "";
  const recipientId = input.item.recipient?.id ? String(input.item.recipient.id) : "";
  const salonIds = new Set([input.entryId, input.igId, input.pageId].filter(Boolean));
  const outgoing =
    Boolean(input.item.message?.is_echo || input.item.message?.is_self) ||
    (Boolean(senderId) && salonIds.has(senderId));
  const otherId = outgoing ? recipientId : senderId;
  const text =
    (input.item.message?.text || "").trim() ||
    (input.item.message?.attachments?.length ? "📷 медіа" : "(без тексту)");
  const receivedAt = messageTime(input.item.timestamp);
  const messageId = input.item.message?.mid ? String(input.item.message.mid) : "";

  let username = normalizeInstagram(input.item.sender?.username);
  let name: string | null = null;
  if (username && input.igUsername && username === normalizeInstagram(input.igUsername)) username = null;
  if (!username && input.pageToken && otherId && !salonIds.has(otherId)) {
    const profile = await graphCall(otherId, input.pageToken, { fields: "username,name" });
    if (!graphCallFailed(profile)) {
      username = normalizeInstagram(typeof profile.data.username === "string" ? profile.data.username : null);
      name = typeof profile.data.name === "string" ? profile.data.name.trim() : null;
      if (username && input.igUsername && username === normalizeInstagram(input.igUsername)) username = null;
    }
  }
  if (!username && input.pageToken && input.pageId) {
    username = await usernameFromLatestThread(input.pageId, input.pageToken, messageId, input.igUsername);
  }

  let status = "отримано";
  if (username) {
    const client = await prisma.directClient.findFirst({
      where: { instagramUsername: username },
      select: { id: true, lastMessageAt: true },
    });
    if (!client) {
      status = "отримано, клієнта в таблиці немає";
    } else if (messageId) {
      const sameId = await prisma.directMessage.findFirst({
        where: { messageId },
        select: { id: true },
      });
      if (sameId) status = "вже було";
      else status = await saveIfNew(client.id, client.lastMessageAt, outgoing, text, messageId, username, receivedAt);
    } else {
      status = await saveIfNew(client.id, client.lastMessageAt, outgoing, text, messageId, username, receivedAt);
    }
  }

  const event: InstagramWebhookEvent = {
    receivedAt: receivedAt.toISOString(),
    direction: outgoing ? "outgoing" : "incoming",
    text: text.slice(0, 500),
    messageId: messageId || null,
    senderId: senderId || null,
    recipientId: recipientId || null,
    username,
    name,
    status,
  };
  await rememberInstagramWebhook(event);
  console.log("[instagram/webhook] Подія", {
    direction: event.direction,
    username,
    status,
    hasText: Boolean(input.item.message?.text),
  });
}

async function saveIfNew(
  clientId: string,
  lastMessageAt: Date | null,
  outgoing: boolean,
  text: string,
  messageId: string,
  username: string,
  receivedAt: Date,
): Promise<string> {
  const direction = outgoing ? "outgoing" : "incoming";
  const nearby = await prisma.directMessage.findMany({
    where: {
      clientId,
      direction,
      receivedAt: {
        gte: new Date(receivedAt.getTime() - DEDUP_WINDOW_MS),
        lte: new Date(receivedAt.getTime() + DEDUP_WINDOW_MS),
      },
    },
    select: { text: true, source: true },
    take: 20,
  });
  const duplicate = nearby.find((row) => {
    if (row.source === "instagram_graph") return false;
    return normText(row.text || "") === normText(text);
  });
  if (duplicate) return duplicate.source === "manychat" ? "вже є з ManyChat" : "вже є в історії";

  await prisma.directMessage.create({
    data: {
      clientId,
      direction,
      text: text.slice(0, 4000),
      messageId: messageId || null,
      source: "instagram_graph",
      receivedAt,
      rawData: JSON.stringify({ username }).slice(0, 2000),
    },
  });
  if (!lastMessageAt || receivedAt > lastMessageAt) {
    await prisma.directClient.update({
      where: { id: clientId },
      data: { lastMessageAt: receivedAt },
    });
  }
  return "записано в історію";
}
