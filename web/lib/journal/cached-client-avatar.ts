// Чи є вже збережене фото клієнта. ManyChat і розбір повідомлень звідси не викликаємо.

import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { kvRead } from "@/lib/kv";
import { normalizeInstagram } from "@/lib/normalize";

function isHttpUrl(raw: unknown): boolean {
  return typeof raw === "string" && /^https?:\/\//i.test(raw.trim());
}

export async function hasCachedClientAvatar(client: {
  id: string;
  instagramUsername?: string | null;
}): Promise<boolean> {
  if (!hasNormalInstagramUsername(client.instagramUsername)) return false;
  const username = (
    normalizeInstagram(client.instagramUsername) ||
    String(client.instagramUsername || "").trim()
  ).toLowerCase();
  if (!username) return false;
  try {
    const byUser = await kvRead.getRaw(`direct:ig-avatar:${username}`);
    if (isHttpUrl(byUser)) return true;
    const byClient = await kvRead.getRaw(`direct:ig-avatar-client:${client.id}`);
    return isHttpUrl(byClient);
  } catch (err) {
    console.warn("[client-avatar] Не вдалось прочитати кеш фото:", err);
    return false;
  }
}
