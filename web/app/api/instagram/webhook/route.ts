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
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
  };
};

function normText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

  let body: {
    object?: string;
    entry?: Array<{ id?: string; messaging?: MessagingItem[]; changes?: Array<{ field?: string; value?: MessagingItem }> }>;
  } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    await rememberInstagramWebhook({
      receivedAt: new Date().toISOString(),
      direction: "incoming",
      text: raw.slice(0, 300),
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
  let pageToken = "";
  if (userToken && pageId) {
    const loaded = await loadInstagramPageToken(userToken, pageId);
    if (!graphCallFailed(loaded)) {
      igId = loaded.igId;
      pageToken = loaded.pageToken;
    }
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  let recognized = 0;
  for (const entry of entries) {
    const entryId = entry.id ? String(entry.id) : "";
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    const fromChanges = Array.isArray(entry.changes)
      ? entry.changes
          .filter((change) => change.field === "messages" || change.field === "message_echoes")
          .map((change) => change.value)
          .filter((value): value is MessagingItem => Boolean(value))
      : [];
    for (const item of [...messaging, ...fromChanges]) {
      if (!item.message) continue;
      recognized += 1;
      try {
        await acceptMessage({
          item,
          entryId,
          igId,
          pageToken,
        });
      } catch (error) {
        console.error("[instagram/webhook] Повідомлення не збереглось", sanitizeMeta(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  if (recognized === 0) {
    const fields = entries.flatMap((entry) => (entry.changes || []).map((change) => change.field).filter(Boolean));
    await rememberInstagramWebhook({
      receivedAt: new Date().toISOString(),
      direction: "incoming",
      text: `object=${body.object || "—"}, записів=${entries.length}, поля=${fields.join(", ") || "немає"}`,
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

async function acceptMessage(input: {
  item: MessagingItem;
  entryId: string;
  igId: string;
  pageToken: string;
}): Promise<void> {
  const senderId = input.item.sender?.id ? String(input.item.sender.id) : "";
  const recipientId = input.item.recipient?.id ? String(input.item.recipient.id) : "";
  const salonIds = new Set([input.entryId, input.igId, (process.env.INSTAGRAM_PAGE_ID || "").trim()].filter(Boolean));
  const outgoing = Boolean(input.item.message?.is_echo) || (Boolean(senderId) && salonIds.has(senderId));
  const otherId = outgoing ? recipientId : senderId;
  const text =
    (input.item.message?.text || "").trim() ||
    (input.item.message?.attachments?.length ? "📷 медіа" : "(без тексту)");
  const at = input.item.timestamp ? new Date(input.item.timestamp) : new Date();
  const receivedAt = Number.isNaN(at.getTime()) ? new Date() : at;
  const messageId = input.item.message?.mid ? String(input.item.message.mid) : "";

  let username: string | null = null;
  let name: string | null = null;
  if (input.pageToken && otherId && !salonIds.has(otherId)) {
    const profile = await graphCall(otherId, input.pageToken, { fields: "username,name" });
    if (!graphCallFailed(profile)) {
      username = normalizeInstagram(typeof profile.data.username === "string" ? profile.data.username : null);
      name = typeof profile.data.name === "string" ? profile.data.name.trim() : null;
    }
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
