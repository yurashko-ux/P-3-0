// Відповідь клієнту в Instagram Direct з CRM. Лише текст, нічого не логуємо з токеном.
// Meta приймає відповідь приблизно 24 години після останнього повідомлення клієнта.

import { prisma } from "@/lib/prisma";
import { normalizeInstagram } from "@/lib/normalize";
import {
  GRAPH,
  graphCall,
  graphCallFailed,
  loadInstagramPageToken,
  sanitizeMeta,
} from "@/lib/instagram-webhook";

const MAX_TEXT = 1000;
export const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type InstagramReplyAvailability = {
  canSend: boolean;
  hasId: boolean;
  windowOpen: boolean;
  lastIncomingAt: string | null;
};

export type InstagramSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function humanSendError(message: string): string {
  const clean = sanitizeMeta(message);
  if (/outside of allowed window|24 hour|messaging window|message sent outside/i.test(clean)) {
    return "Клієнт давно не писав. Instagram приймає відповідь лише близько 24 годин після його повідомлення.";
  }
  if (/permission|pages_messaging|\(#200\)|\(#10\)/i.test(clean)) {
    return "Instagram не дозволив відправку цим токеном.";
  }
  return clean.slice(0, 300) || "Instagram не прийняв повідомлення.";
}

async function postText(igId: string, pageToken: string, recipientId: string, text: string): Promise<InstagramSendResult> {
  let response: Response;
  try {
    response = await fetch(`${GRAPH}/${igId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, message: aborted ? "Instagram не відповів вчасно." : "Не вдалося з’єднатися з Instagram." };
  }
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  const error = asRecord(data.error);
  if (!response.ok || error) {
    const message = typeof error?.message === "string" ? error.message : raw.slice(0, 300);
    console.warn("[instagram/send] Відповідь не пішла", sanitizeMeta(message));
    return { ok: false, message: humanSendError(message) };
  }
  const messageId = typeof data.message_id === "string" ? data.message_id : "";
  if (!messageId) return { ok: false, message: "Instagram не повернув ідентифікатор повідомлення." };
  return { ok: true, messageId };
}

async function scopedIdFromRecentThreads(pageId: string, pageToken: string, username: string, salonUsername: string): Promise<string | null> {
  const wanted = normalizeInstagram(username);
  const salon = normalizeInstagram(salonUsername);
  if (!wanted) return null;
  let after = "";
  for (let page = 0; page < 4; page += 1) {
    const params: Record<string, string> = { platform: "instagram", fields: "id", limit: "1" };
    if (after) params.after = after;
    const listed = await graphCall(`${pageId}/conversations`, pageToken, params);
    if (graphCallFailed(listed)) return null;
    const conversations = Array.isArray(listed.data.data) ? listed.data.data : [];
    const first = asRecord(conversations[0]);
    const conversationId = first?.id ? String(first.id) : "";
    const paging = asRecord(asRecord(listed.data.paging)?.cursors);
    after = typeof paging?.after === "string" ? paging.after : "";
    if (!conversationId) return null;
    const messages = await graphCall(`${conversationId}/messages`, pageToken, {
      fields: "id,from",
      limit: "8",
    });
    if (!graphCallFailed(messages)) {
      const rows = Array.isArray(messages.data.data) ? messages.data.data : [];
      for (const row of rows) {
        const record = asRecord(row);
        const from = asRecord(record?.from);
        const nick = normalizeInstagram(typeof from?.username === "string" ? from.username : null);
        const id = from?.id ? String(from.id) : "";
        if (nick && nick === wanted && id) return id;
        if (nick && nick !== salon && !wanted) return id || null;
      }
    }
    if (!after) break;
  }
  return null;
}

export async function instagramReplyAvailability(clientId: string): Promise<InstagramReplyAvailability> {
  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { id: true, instagramUsername: true, instagramScopedId: true },
  });
  if (!client) {
    return { canSend: false, hasId: false, windowOpen: false, lastIncomingAt: null };
  }

  const lastIncoming = await prisma.directMessage.findFirst({
    where: { clientId, direction: "incoming" },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const lastIncomingAt = lastIncoming?.receivedAt ?? null;
  const windowOpen = Boolean(
    lastIncomingAt && Date.now() - lastIncomingAt.getTime() <= INSTAGRAM_REPLY_WINDOW_MS,
  );

  const hasId = Boolean((client.instagramScopedId || "").trim());
  return {
    canSend: hasId && windowOpen,
    hasId,
    windowOpen,
    lastIncomingAt: lastIncomingAt ? lastIncomingAt.toISOString() : null,
  };
}

export async function sendInstagramDirectReply(clientId: string, text: string): Promise<InstagramSendResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: "Введіть текст." };
  if (trimmed.length > MAX_TEXT) return { ok: false, message: `Текст довший за ${MAX_TEXT} символів.` };

  const availability = await instagramReplyAvailability(clientId);
  if (!availability.windowOpen) {
    return { ok: false, message: "Минуло більше 24 годин від останнього повідомлення клієнта." };
  }

  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { id: true, instagramUsername: true, instagramScopedId: true, lastMessageAt: true },
  });
  if (!client) return { ok: false, message: "Клієнта немає." };

  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  if (!userToken || !pageId) return { ok: false, message: "Instagram не підключений." };
  const loaded = await loadInstagramPageToken(userToken, pageId);
  if (graphCallFailed(loaded)) return { ok: false, message: loaded.message };
  if (!loaded.igId) return { ok: false, message: "Немає ідентифікатора Instagram салону." };

  let recipientId = (client.instagramScopedId || "").trim();
  if (!recipientId) {
    recipientId = (await scopedIdFromRecentThreads(pageId, loaded.pageToken, client.instagramUsername, loaded.igUsername)) || "";
    if (recipientId) {
      await prisma.directClient.update({
        where: { id: client.id },
        data: { instagramScopedId: recipientId },
      });
    }
  }
  if (!recipientId) {
    return { ok: false, message: "Ще немає технічного id цього клієнта. Нехай він напише в Direct ще раз." };
  }

  const sent = await postText(loaded.igId, loaded.pageToken, recipientId, trimmed);
  if (!sent.ok) return sent;

  const existing = await prisma.directMessage.findFirst({
    where: { messageId: sent.messageId },
    select: { id: true },
  });
  const now = new Date();
  if (!existing) {
    await prisma.directMessage.create({
      data: {
        clientId: client.id,
        direction: "outgoing",
        text: trimmed,
        messageId: sent.messageId,
        source: "instagram_graph",
        receivedAt: now,
        rawData: JSON.stringify({ username: normalizeInstagram(client.instagramUsername), sentFrom: "crm" }).slice(0, 2000),
      },
    });
    await prisma.directClient.update({
      where: { id: client.id },
      data: { lastMessageAt: now },
    });
  }
  console.log("[instagram/send] Відповідь надіслано", { clientId: client.id });
  return sent;
}
