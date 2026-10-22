// Лайк самого салону Meta не присилає вебхуком (message_reactions — лише від клієнта).
// Коли відкривають історію, читаємо reactions останніх повідомлень і зберігаємо лайк салону.

import { prisma } from "@/lib/prisma";
import { normalizeInstagram } from "@/lib/normalize";
import {
  graphCall,
  graphCallFailed,
  loadInstagramPageToken,
  resolveInstagramReactionEmoji,
} from "@/lib/instagram-webhook";

const RECENT_MESSAGES = 8;

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

/** Підтягує лайк салону на останні повідомлення діалогу. Помилка Meta не ламає історію. */
export async function syncInstagramSalonReactions(clientId: string): Promise<number> {
  const userToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const pageId = (process.env.INSTAGRAM_PAGE_ID || "").trim();
  if (!userToken || !pageId) return 0;

  const client = await prisma.directClient.findFirst({
    where: { id: clientId },
    select: { instagramUsername: true, instagramScopedId: true },
  });
  if (!client) return 0;

  const loaded = await loadInstagramPageToken(userToken, pageId);
  if (graphCallFailed(loaded)) {
    console.warn("[instagram/reactions] Токен сторінки не відкрився", loaded.message);
    return 0;
  }

  const recent = await prisma.directMessage.findMany({
    where: {
      clientId,
      source: "instagram_graph",
      messageId: { not: null },
    },
    orderBy: { receivedAt: "desc" },
    take: RECENT_MESSAGES,
    select: { messageId: true },
  });
  const mids = recent.map((row) => (row.messageId || "").trim()).filter((mid) => mid && !mid.startsWith("reaction:"));
  if (!mids.length) return 0;

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
    mids.map(async (mid) => {
      const result = await graphCall(encodeURIComponent(mid), loaded.pageToken, { fields: "reactions" });
      if (graphCallFailed(result)) {
        console.warn("[instagram/reactions] Не прочитано реакції повідомлення", result.message);
        return;
      }
      if (mid === mids[0] && result.data.reactions == null) {
        console.log("[instagram/reactions] У відповіді немає reactions", {
          keys: Object.keys(result.data).slice(0, 12),
        });
      }
      const groups = reactionUsers(result.data.reactions);
      const salonReaction = groups.find((group) =>
        group.users.some((user) => isSalonUser(user, salon, clientWho)),
      );
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
        if (everyoneKnown) {
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
        select: { id: true, text: true },
      });
      if (existing) {
        if (existing.text !== text) {
          await prisma.directMessage.update({
            where: { id: existing.id },
            data: { text, rawData },
          });
          saved += 1;
        }
        return;
      }
      await prisma.directMessage.create({
        data: {
          clientId,
          direction: "outgoing",
          text,
          messageId: key,
          source: "instagram_reaction",
          receivedAt: new Date(),
          rawData,
        },
      });
      saved += 1;
      console.log("[instagram/reactions] Лайк салону збережено", { clientId, emoji });
    }),
  );
  return saved;
}
