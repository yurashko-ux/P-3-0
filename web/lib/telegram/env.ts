export const TELEGRAM_ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  REPORT_GROUP_ID: process.env.TELEGRAM_PHOTO_GROUP_ID
    ? Number(process.env.TELEGRAM_PHOTO_GROUP_ID)
    : null,
  ADMIN_CHAT_IDS: process.env.TELEGRAM_ADMIN_CHAT_IDS
    ? process.env.TELEGRAM_ADMIN_CHAT_IDS.split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id))
    : [],
};

export function assertTelegramEnv() {
  if (!TELEGRAM_ENV.BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN env variable");
  }
}

export function telegramApiUrl(path: string) {
  assertTelegramEnv();
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `https://api.telegram.org/bot${TELEGRAM_ENV.BOT_TOKEN}/${normalizedPath}`;
}

