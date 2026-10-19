// Очікувана видача доступу в Telegram: коли у користувача ще немає telegramChatId
// (не натиснув /start боту), зберігаємо креденшали в KV і віддаємо deep-link.
// Після /start бот @ZVITY_HoB_bot сам надішле логін/пароль.

import { createHash, randomBytes } from "crypto";
import { kvRead, kvWrite } from "@/lib/kv";

export const REPORTS_BOT_USERNAME = "ZVITY_HoB_bot";

const TTL_MS = 48 * 60 * 60 * 1000; // 48 годин

export type PendingAccess = {
  token: string;
  userId: string;
  login: string;
  password: string;
  crescoLoginUrl: string;
  telegramUsername: string;
  expiresAt: string;
  createdAt: string;
};

function tokenKey(token: string): string {
  return `access:pending:token:${token}`;
}

function userKey(userId: string): string {
  return `access:pending:user:${userId}`;
}

function parsePending(raw: unknown): PendingAccess | null {
  try {
    let v: unknown = raw;
    if (typeof v === "string") v = JSON.parse(v);
    if (v && typeof v === "object" && "value" in v && typeof (v as { value: string }).value === "string") {
      v = JSON.parse((v as { value: string }).value);
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.token !== "string" || typeof o.userId !== "string") return null;
    if (typeof o.login !== "string" || typeof o.password !== "string") return null;
    return o as unknown as PendingAccess;
  } catch {
    return null;
  }
}

export function buildAccessDeepLink(token: string): string {
  return `https://t.me/${REPORTS_BOT_USERNAME}?start=access_${token}`;
}

/** Створює (або перезаписує) очікувану видачу доступу. Повертає deep-link для користувача. */
export async function createPendingAccess(input: {
  userId: string;
  login: string;
  password: string;
  crescoLoginUrl: string;
  telegramUsername: string;
}): Promise<{ token: string; deepLink: string; expiresAt: string }> {
  // Короткий токен: лише [A-Za-z0-9_], ≤64 символи разом із префіксом access_
  const token = randomBytes(12).toString("base64url").replace(/-/g, "x").slice(0, 16);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
  const pending: PendingAccess = {
    token,
    userId: input.userId,
    login: input.login,
    password: input.password,
    crescoLoginUrl: input.crescoLoginUrl,
    telegramUsername: input.telegramUsername,
    expiresAt,
    createdAt: now.toISOString(),
  };

  // Якщо вже було старе посилання — прибираємо токен
  try {
    const prevTokenRaw = await kvRead.getRaw(userKey(input.userId));
    const prevToken =
      typeof prevTokenRaw === "string"
        ? prevTokenRaw.replace(/^"|"$/g, "").trim()
        : prevTokenRaw && typeof prevTokenRaw === "object" && "value" in (prevTokenRaw as object)
          ? String((prevTokenRaw as { value: string }).value || "").trim()
          : "";
    if (prevToken && prevToken !== token) {
      await kvWrite.setRaw(tokenKey(prevToken), JSON.stringify({ expired: true }));
    }
  } catch {
    // ignore
  }

  await kvWrite.setRaw(tokenKey(token), JSON.stringify(pending));
  await kvWrite.setRaw(userKey(input.userId), token);

  console.log("[access/pending] Створено очікувану видачу доступу", {
    userId: input.userId,
    login: input.login,
    telegramUsername: input.telegramUsername,
    tokenHash: createHash("sha256").update(token).digest("hex").slice(0, 12),
    expiresAt,
  });

  return { token, deepLink: buildAccessDeepLink(token), expiresAt };
}

export async function peekPendingAccessByToken(token: string): Promise<PendingAccess | null> {
  const clean = String(token || "").trim();
  if (!clean) return null;
  const raw = await kvRead.getRaw(tokenKey(clean));
  const pending = parsePending(raw);
  if (!pending) return null;
  if (new Date(pending.expiresAt).getTime() < Date.now()) return null;
  return pending;
}

export async function peekPendingAccessByUserId(userId: string): Promise<PendingAccess | null> {
  const raw = await kvRead.getRaw(userKey(userId));
  let token = "";
  if (typeof raw === "string") token = raw.replace(/^"|"$/g, "").trim();
  else if (raw && typeof raw === "object" && "value" in (raw as object)) {
    token = String((raw as { value: string }).value || "").trim();
  }
  if (!token) return null;
  return peekPendingAccessByToken(token);
}

/** Забирає pending (одноразово) — після успішної видачі в Telegram. */
export async function consumePendingAccess(token: string): Promise<PendingAccess | null> {
  const pending = await peekPendingAccessByToken(token);
  if (!pending) return null;
  try {
    await kvWrite.setRaw(tokenKey(token), JSON.stringify({ consumed: true, at: new Date().toISOString() }));
    await kvWrite.setRaw(userKey(pending.userId), "");
  } catch (err) {
    console.warn("[access/pending] Не вдалося очистити KV після consume:", err);
  }
  return pending;
}

export async function consumePendingAccessForUser(userId: string): Promise<PendingAccess | null> {
  const pending = await peekPendingAccessByUserId(userId);
  if (!pending) return null;
  return consumePendingAccess(pending.token);
}
