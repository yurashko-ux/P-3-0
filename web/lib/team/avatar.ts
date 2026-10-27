// Власне фото співробітника команди. Лежить у KV, без поля в Prisma.

import { kvRead, kvWrite } from "@/lib/kv";

const MAX_DATA_URL_CHARS = 400_000;

export function teamMemberAvatarKey(memberId: string) {
  return `team:member-avatar:${memberId}`;
}

export async function readTeamMemberAvatar(memberId: string): Promise<string | null> {
  const raw = await kvRead.getRaw(teamMemberAvatarKey(memberId));
  if (!raw || !raw.startsWith("data:image/")) return null;
  return raw;
}

export async function saveTeamMemberAvatar(memberId: string, dataUrl: string): Promise<void> {
  const value = String(dataUrl || "").trim();
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(value)) {
    throw new Error("Потрібне зображення jpeg, png або webp");
  }
  if (value.length > MAX_DATA_URL_CHARS) {
    throw new Error("Фото завелике. Оберіть менший знімок");
  }
  await kvWrite.setRaw(teamMemberAvatarKey(memberId), value);
  console.log("[team/avatar] Збережено фото співробітника", { memberId, chars: value.length });
}

export function decodeDataImage(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
  } catch {
    return null;
  }
}
