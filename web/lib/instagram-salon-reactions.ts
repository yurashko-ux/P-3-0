// Лайк самого салону Meta часто не присилає вебхуком (message_reactions — здебільшого від клієнта).
// Коли відкривають історію, читаємо reactions останніх повідомлень і зберігаємо лайк салону.

import { prisma } from "@/lib/prisma";
import { normalizeInstagram } from "@/lib/normalize";
import {
  graphCall,
  graphCallFailed,
  loadInstagramPageToken,
  resolveInstagramReactionEmoji,
} from "@/lib/instagram-webhook";

const RECENT_MESSAGES = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function salonReactionKey(mid: string): string {
  return `reaction:react:${mid}:salon`;
}

type ReactionUser = { id: string; username: string };

function reactionUsers(value: unknown): Array<{ reaction: string; users: ReactionUser[] }> {
  const root = asRecord(value);
  const rows = root && Array.isArray(root.data) ? root.data : value != null ? [value] : [];
  const out: Array<{ reaction: string; users: ReactionUser[] }> = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const reaction = typeof record.reaction === "string" ? record.reaction.trim() : "";
    const usersNode = asRecord(record.users);
    const usersRaw = Array.isArray(record.users)
      ? record.users
      : usersNode && Array.isArray(usersNode.data)
        ? usersNode.data
        : [];
    const users: ReactionUser[] = [];
    for (const user of usersRaw) {
      const person = asRecord(user);
      if (!person) continue;
      users.push({
        id: person.id ? String(person.id) : "",
        username: typeof person.username === "string" ? person.username : "",
      });
    }
    if (reaction || users.length) out.push({ reaction, users });
  }
  return out;
}

function isSalonUser(
  user: ReactionUser,
  salon: { igId: string; pageId: string; igUsername: string },
  client: { scopedId: string; username: string },
): boolean {
  if (user.id && (user.id === salon.igId || user.id === salon.pageId)) return true;
  const nick = normalizeInstagram(user.username);
  if (nick && salon.igUsername && nick === salon.igUsername) return true;
  if (nick && client.username && nick === client.username) return false;
  if (user.id && client.scopedId && user.id === client.scopedId) return false;
  if (user.id && client.scopedId && user.id !== client.scopedId) return true;
  return false;
}

function splitReaction(value: string): { emoji: string | null; reaction: string | null } {
  const text = value.trim();
  if (!text) return { emoji: null, reaction: null };
  if (/^[a-z_]+$/i.test(text)) return { emoji: null, reaction: text.toLowerCase() };
  return { emoji: text, reaction: null };
}

async function bumpClientLastMessage(clientId: string, at: Date): Promise<void> {
  await prisma.directClient.updateMany({
    where: {
      id: clientId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }],
    },
    data: { lastMessageAt: at },
  });
}

/** Підтягує лайк салону на останні повідомлення діалогу. Помилка Meta не ламає історію. */
export async function syncInstagramSalonReactions(clientId: string): Promise<number> {
  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  if (!userToken || !pageId) return 0;

  const client = await prisma.directClient.findFirst({
    where: { id: clientId },
    select: { instagramUsername: true, instagramScopedId: true, lastMessageAt: true },
  });
  if (!client) return 0;

  const loaded = await loadInstagramPageToken(userToken, pageId);
  if (graphCallFailed(loaded)) {
    console.warn("[instagram/reactions] Токен сторінки не відкрився", loaded.message);
    return 0;
  }

  // Спочатку свіжі вхідні (салон лайкає саме їх), потім інші Graph-повідомлення.
  const recentIncoming = await prisma.directMessage.findMany({
    where: {
      clientId,
      source: "instagram_graph",
      direction: "incoming",
      messageId: { not: null },
    },
    orderBy: { receivedAt: "desc" },
    take: RECENT_MESSAGES,
    select: { messageId: true, receivedAt: true },
  });
  const recentOther = await prisma.directMessage.findMany({
    where: {
      clientId,
      source: "instagram_graph",
      messageId: { not: null },
      NOT: { direction: "incoming" },
    },
    orderBy: { receivedAt: "desc" },
    take: Math.max(4, RECENT_MESSAGES - recentIncoming.length),
    select: { messageId: true, receivedAt: true },
  });
  const seen = new Set<string>();
  const recent: Array<{ messageId: string; receivedAt: Date }> = [];
  for (const row of [...recentIncoming, ...recentOther]) {
    const mid = (row.messageId || "").trim();
    if (!mid || mid.startsWith("reaction:") || seen.has(mid)) continue;
    seen.add(mid);
    recent.push({ messageId: mid, receivedAt: row.receivedAt });
  }
  if (!recent.length) return 0;

  const salon = {
    igId: loaded.igId,
    pageId,
    igUsername: normalizeInstagram(loaded.igUsername) || "",
  };
  const clientWho = {
    scopedId: (client.instagramScopedId || "").trim(),
    username: normalizeInstagram(client.instagramUsername) || "",
  };

  let saved = 0;
  await Promise.all(
    recent.map(async (row) => {
      const mid = row.messageId;
      // Розширені поля: без users Meta інколи все одно віддає reaction (лайк сторінки).
      const result = await graphCall(encodeURIComponent(mid), loaded.pageToken, {
        fields: "id,reactions{reaction,users{id,username}}",
      });
      if (graphCallFailed(result)) {
        console.warn("[instagram/reactions] Не прочитано реакції повідомлення", {
          mid: mid.slice(0, 24),
          message: result.message,
        });
        return;
      }
      if (mid === recent[0]?.messageId) {
        console.log("[instagram/reactions] Відповідь Graph для свіжого mid", {
          mid: mid.slice(0, 24),
          hasReactions: result.data.reactions != null,
          keys: Object.keys(result.data).slice(0, 12),
        });
      }
      const groups = reactionUsers(result.data.reactions);
      let salonReaction =
        groups.find((group) => group.users.some((user) => isSalonUser(user, salon, clientWho))) ||
        null;
      // Graph часто віддає лайк акаунта сторінки без users — тоді вважаємо його салонним.
      if (!salonReaction) {
        const orphan = groups.find((group) => group.reaction && group.users.length === 0);
        if (orphan) {
          salonReaction = orphan;
          console.log("[instagram/reactions] Реакція без users → салон", {
            mid: mid.slice(0, 24),
            reaction: orphan.reaction,
          });
        }
      }
      const key = salonReactionKey(mid);
      const users = groups.flatMap((group) => group.users);
      const everyoneKnown =
        users.length === 0 ||
        users.every(
          (user) =>
            isSalonUser(user, salon, clientWho) ||
            (clientWho.scopedId && user.id === clientWho.scopedId) ||
            (clientWho.username && normalizeInstagram(user.username) === clientWho.username),
        );
      if (!salonReaction) {
        // Порожня відповідь або всі люди впізнані і салону серед них немає — лайк знято.
        // Якщо Meta повернула невідомих людей, запис не чіпаємо.
        // orphan-випадок (users=[]) уже оброблено вище як салон.
        if (everyoneKnown && groups.every((g) => g.users.length > 0)) {
          await prisma.directMessage.deleteMany({ where: { clientId, messageId: key } });
        } else if (groups.length === 0) {
          await prisma.directMessage.deleteMany({ where: { clientId, messageId: key } });
        }
        return;
      }
      const parts = splitReaction(salonReaction.reaction);
      const emoji = resolveInstagramReactionEmoji(parts.emoji, parts.reaction);
      const text = `${emoji} реакція`;
      const rawData = JSON.stringify({
        kind: "reaction",
        action: "react",
        emoji: parts.emoji,
        reaction: parts.reaction,
        reactedMessageId: mid,
        username: salon.igUsername || null,
      }).slice(0, 2000);
      const existing = await prisma.directMessage.findFirst({
        where: { clientId, messageId: key },
        select: { id: true, text: true, receivedAt: true },
      });
      // Якщо lastMessageAt ще на рівні тексту (на який лайкнули) — реакція не підняла картку.
      const clientFresh = await prisma.directClient.findFirst({
        where: { id: clientId },
        select: { lastMessageAt: true },
      });
      const neverLifted =
        !clientFresh?.lastMessageAt || clientFresh.lastMessageAt.getTime() <= row.receivedAt.getTime() + 2000;
      if (existing) {
        const data: { text?: string; rawData?: string; receivedAt?: Date } = {};
        if (existing.text !== text) {
          data.text = text;
          data.rawData = rawData;
        }
        if (neverLifted) {
          data.receivedAt = new Date();
        }
        if (Object.keys(data).length > 0) {
          await prisma.directMessage.update({ where: { id: existing.id }, data });
          saved += 1;
        }
        await bumpClientLastMessage(
          clientId,
          data.receivedAt || existing.receivedAt,
        );
        return;
      }
      // Нова реакція — час «зараз», щоб картка піднялась вище за «Сонце».
      const receivedAt = new Date();
      await prisma.directMessage.create({
        data: {
          clientId,
          direction: "outgoing",
          text,
          messageId: key,
          source: "instagram_reaction",
          receivedAt,
          rawData,
        },
      });
      await bumpClientLastMessage(clientId, receivedAt);
      saved += 1;
      console.log("[instagram/reactions] Лайк салону збережено", {
        clientId,
        emoji,
        mid: mid.slice(0, 24),
        lifted: true,
      });
    }),
  );
  return saved;
}
