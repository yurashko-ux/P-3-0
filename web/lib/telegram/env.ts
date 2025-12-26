export const TELEGRAM_ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN?.trim() || "", // Токен для фото-бота
  // Токен для нагадувань Direct клієнтів (HOB_client_bot)
  HOB_CLIENT_BOT_TOKEN: process.env.TELEGRAM_HOB_CLIENT_BOT_TOKEN?.trim() || "",
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
  if (!TELEGRAM_ENV.BOT_TOKEN && !TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_HOB_CLIENT_BOT_TOKEN env variable");
  }
}

/**
 * Перевіряє, чи встановлено токен для нагадувань Direct клієнтів (HOB_client_bot)
 */
export function assertDirectRemindersBotToken() {
  if (!TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN && !TELEGRAM_ENV.BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_HOB_CLIENT_BOT_TOKEN or TELEGRAM_BOT_TOKEN env variable");
  }
}

export function telegramApiUrl(path: string, botToken?: string) {
  const token = botToken || TELEGRAM_ENV.BOT_TOKEN;
  if (!token) {
    throw new Error("Missing Telegram bot token");
  }
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `https://api.telegram.org/bot${token}/${normalizedPath}`;
}

