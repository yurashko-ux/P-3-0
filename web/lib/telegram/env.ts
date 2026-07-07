export const TELEGRAM_ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN?.trim() || "", // Токен для фото-бота
  // Токен для нагадувань Direct клієнтів (HOB_client_bot)
  HOB_CLIENT_BOT_TOKEN: process.env.TELEGRAM_HOB_CLIENT_BOT_TOKEN?.trim() || "",
  // Окремий бот для зведення ФОП-платежів (@Platezi_FOP_bot)
  PAYMENTS_BOT_TOKEN: process.env.TELEGRAM_PAYMENTS_BOT_TOKEN?.trim() || "",
  REPORTS_BOT_TOKEN: process.env.TELEGRAM_REPORTS_BOT_TOKEN?.trim() || "",
  /** ID business-зʼєднання салону (Telegram Business + HOB_client_bot); альтернатива — KV inactive-base:telegram:business_connection_id */
  BUSINESS_CONNECTION_ID: process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim() || "",
  /** Telegram user id акаунта салону (для direction вихідних); альтернатива — KV inactive-base:telegram:business_user_id */
  BUSINESS_USER_ID: process.env.TELEGRAM_BUSINESS_USER_ID?.trim() || "",
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
  PAYMENTS_ADMIN_CHAT_IDS: process.env.TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS
    ? process.env.TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS.split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id))
    : [],
  ENCASHMENT_OWNER_CHAT_IDS: process.env.TELEGRAM_ENCASHMENT_OWNER_CHAT_IDS
    ? process.env.TELEGRAM_ENCASHMENT_OWNER_CHAT_IDS.split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id))
    : [],
  REPORTS_RECIPIENT_CHAT_IDS: process.env.TELEGRAM_REPORTS_RECIPIENT_CHAT_IDS
    ? process.env.TELEGRAM_REPORTS_RECIPIENT_CHAT_IDS.split(",")
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

export function assertPaymentsBotToken() {
  if (!TELEGRAM_ENV.PAYMENTS_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_PAYMENTS_BOT_TOKEN env variable");
  }
}

export function assertReportsBotToken() {
  if (!TELEGRAM_ENV.REPORTS_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_REPORTS_BOT_TOKEN env variable");
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

