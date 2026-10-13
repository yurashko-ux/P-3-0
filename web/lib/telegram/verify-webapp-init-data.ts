// Перевірка Telegram WebApp initData (Mini App) для /master.
// Алгоритм за документацією Telegram:
// secret_key = HMAC_SHA256(bot_token, "WebAppData")
// hash = hex(HMAC_SHA256(data_check_string, secret_key))
// data_check_string — усі поля initData (крім hash), сортовані за ключем, "key=value" через "\n".

import { createHmac } from "crypto";
import { TELEGRAM_ENV } from "./env";

export type TelegramWebAppUser = {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** initData старіший за це — вважаємо недійсним (на випадок перехопленого/застарілого рядка). */
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

function parseUserField(raw: string | null): TelegramWebAppUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    if (!parsed || typeof parsed.id !== "number") return null;
    return {
      id: parsed.id,
      username: parsed.username || null,
      firstName: parsed.first_name || null,
      lastName: parsed.last_name || null,
    };
  } catch {
    return null;
  }
}

/**
 * Перевіряє підпис initData від Telegram WebApp і повертає користувача.
 * Повертає null, якщо підпис невалідний, відсутній, або auth_date застарів.
 */
export function verifyTelegramWebAppInitData(
  initData: string | null | undefined,
  botToken: string = TELEGRAM_ENV.MASTER_BOT_TOKEN,
): TelegramWebAppUser | null {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) return null;

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (expectedHash.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedHash.length; i++) {
    diff |= expectedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) return null;

  return parseUserField(params.get("user"));
}
