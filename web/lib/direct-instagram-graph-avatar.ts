// Аватар з Instagram Graph (IGSID / діалог) — для лідів без ManyChat (кнопка #6).

import { prisma } from "@/lib/prisma";
import { kvWrite } from "@/lib/kv";
import { normalizeInstagram } from "@/lib/normalize";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import {
  graphCall,
  graphCallFailed,
  loadInstagramPageToken,
} from "@/lib/instagram-webhook";

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
const directAvatarByClientKey = (clientId: string) => `direct:ig-avatar-client:${clientId}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickProfilePic(node: Record<string, unknown> | null): string | null {
  if (!node) return null;
  for (const key of ["profile_pic", "profile_picture", "profile_pic_url", "profile_picture_url"]) {
    const v = node[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  return null;
}

async function loadPageAuth(): Promise<
  | { ok: true; pageToken: string; igId: string; igUsername: string }
  | { ok: false; reason: string }
> {
  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  if (!userToken || !pageId) return { ok: false, reason: "no_instagram_token" };
  const loaded = await loadInstagramPageToken(userToken, pageId);
  if (graphCallFailed(loaded)) return { ok: false, reason: loaded.message };
  if (!loaded.pageToken) return { ok: false, reason: "no_page_token" };
  return {
    ok: true,
    pageToken: loaded.pageToken,
    igId: loaded.igId || "",
    igUsername: normalizeInstagram(loaded.igUsername) || "",
  };
}

/** profile_pic за Instagram-scoped user id. */
export async function fetchGraphProfilePicByIgsid(
  igsid: string,
  pageToken?: string,
): Promise<string | null> {
  const id = String(igsid || "").trim();
  if (!id) return null;
  let token = (pageToken || "").trim();
  if (!token) {
    const auth = await loadPageAuth();
    if (!auth.ok) return null;
    token = auth.pageToken;
  }
  const res = await graphCall(id, token, { fields: "name,username,profile_pic" });
  if (graphCallFailed(res)) {
    console.warn("[ig-graph-avatar] profile_pic fail", { igsid: id.slice(0, 8), message: res.message });
    return null;
  }
  return pickProfilePic(asRecord(res.data));
}

/** IGSID з учасників діалогу (клієнт ≠ салон). */
export async function resolveIgsidFromConversation(
  conversationId: string,
  opts?: { pageToken?: string; salonIgId?: string; salonUsername?: string; wantedUsername?: string },
): Promise<string | null> {
  const threadId = String(conversationId || "").trim();
  if (!threadId) return null;
  let token = (opts?.pageToken || "").trim();
  let salonIgId = (opts?.salonIgId || "").trim();
  let salonUsername = normalizeInstagram(opts?.salonUsername || "") || "";
  if (!token || !salonIgId) {
    const auth = await loadPageAuth();
    if (!auth.ok) return null;
    token = token || auth.pageToken;
    salonIgId = salonIgId || auth.igId;
    salonUsername = salonUsername || auth.igUsername;
  }
  const wanted = normalizeInstagram(opts?.wantedUsername || "") || "";

  const participants = await graphCall(threadId, token, {
    fields: "participants{id,username,name}",
  });
  if (!graphCallFailed(participants)) {
    const data = asRecord(participants.data);
    const list = Array.isArray(asRecord(data?.participants)?.data)
      ? (asRecord(data?.participants)?.data as unknown[])
      : Array.isArray(data?.participants)
        ? (data?.participants as unknown[])
        : [];
    for (const row of list) {
      const person = asRecord(row);
      const id = person?.id ? String(person.id) : "";
      const nick = normalizeInstagram(typeof person?.username === "string" ? person.username : null);
      if (!id) continue;
      if (salonIgId && id === salonIgId) continue;
      if (nick && salonUsername && nick === salonUsername) continue;
      if (wanted && nick && nick === wanted) return id;
      if (!wanted) return id;
      if (wanted && !nick) return id;
    }
    if (wanted) {
      for (const row of list) {
        const person = asRecord(row);
        const id = person?.id ? String(person.id) : "";
        if (!id || (salonIgId && id === salonIgId)) continue;
        return id;
      }
    }
  }

  // Fallback: from у повідомленнях діалогу
  const messages = await graphCall(`${threadId}/messages`, token, {
    fields: "from",
    limit: "10",
  });
  if (graphCallFailed(messages)) return null;
  const rows = Array.isArray(messages.data.data) ? messages.data.data : [];
  for (const row of rows) {
    const from = asRecord(asRecord(row)?.from);
    const id = from?.id ? String(from.id) : "";
    const nick = normalizeInstagram(typeof from?.username === "string" ? from.username : null);
    if (!id) continue;
    if (salonIgId && id === salonIgId) continue;
    if (nick && salonUsername && nick === salonUsername) continue;
    if (wanted && nick && nick !== wanted) continue;
    return id;
  }
  return null;
}

async function conversationIdFromClientMessages(clientId: string): Promise<string | null> {
  const rows = await prisma.directMessage.findMany({
    where: { clientId, rawData: { not: null } },
    orderBy: { receivedAt: "desc" },
    take: 12,
    select: { rawData: true },
  });
  for (const row of rows) {
    const raw = row.rawData || "";
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const cid = typeof parsed.conversationId === "string" ? parsed.conversationId.trim() : "";
      if (cid) return cid;
    } catch {
      const m = raw.match(/"conversationId"\s*:\s*"([^"]+)"/);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

async function persistAvatarKv(opts: {
  url: string;
  username?: string | null;
  clientId?: string | null;
}) {
  const url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) return;
  const username = normalizeInstagram(opts.username || "") || "";
  const clientId = (opts.clientId || "").trim();
  try {
    if (username && hasNormalInstagramUsername(username)) {
      await kvWrite.setRaw(directAvatarKey(username), url);
    }
    if (clientId) await kvWrite.setRaw(directAvatarByClientKey(clientId), url);
  } catch {
    // некритично
  }
}

/**
 * Підтягує аватар через Graph для клієнта Direct (IGSID або conversationId з rawData).
 * Повертає URL або null.
 */
export async function resolveInstagramGraphAvatar(opts: {
  clientId: string;
  username?: string | null;
  igsid?: string | null;
}): Promise<{ ok: boolean; avatarUrl?: string; reason?: string; igsid?: string }> {
  const clientId = (opts.clientId || "").trim();
  if (!clientId) return { ok: false, reason: "no_client" };
  const username = normalizeInstagram(opts.username || "") || "";

  const auth = await loadPageAuth();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  let igsid = String(opts.igsid || "").trim();
  if (!igsid) {
    const row = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { instagramScopedId: true, instagramUsername: true },
    });
    igsid = (row?.instagramScopedId || "").trim();
    if (!username && row?.instagramUsername) {
      // keep local username for KV key
    }
  }

  if (!igsid) {
    const conversationId = await conversationIdFromClientMessages(clientId);
    if (conversationId) {
      igsid =
        (await resolveIgsidFromConversation(conversationId, {
          pageToken: auth.pageToken,
          salonIgId: auth.igId,
          salonUsername: auth.igUsername,
          wantedUsername: username,
        })) || "";
      if (igsid) {
        try {
          await prisma.directClient.update({
            where: { id: clientId },
            data: { instagramScopedId: igsid },
          });
        } catch {
          // ignore
        }
      }
    }
  }

  if (!igsid) return { ok: false, reason: "no_igsid" };

  const pic = await fetchGraphProfilePicByIgsid(igsid, auth.pageToken);
  if (!pic) return { ok: false, reason: "no_profile_pic", igsid };

  await persistAvatarKv({ url: pic, username, clientId });
  console.log("[ig-graph-avatar] ✅ Аватар з Graph", {
    clientId,
    username: username || null,
    igsid: igsid.slice(0, 8),
  });
  return { ok: true, avatarUrl: pic, igsid };
}

/** Для #6: зберегти profile_pic у KV за вже відомим IGSID. */
export async function warmGraphAvatarByIgsid(opts: {
  igsid: string;
  username?: string | null;
  clientId?: string | null;
  pageToken?: string;
}): Promise<{ ok: boolean; avatarUrl?: string }> {
  const pic = await fetchGraphProfilePicByIgsid(opts.igsid, opts.pageToken);
  if (!pic) return { ok: false };
  await persistAvatarKv({ url: pic, username: opts.username, clientId: opts.clientId });
  return { ok: true, avatarUrl: pic };
}
