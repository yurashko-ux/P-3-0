// Секрети Notion і бота @NOTION_HofB_bot. Значення не логуємо і не віддаємо на клієнт.

export function getNotionToken(): string {
  return (process.env.NOTION_TOKEN || "").trim();
}

export function getNotionWebhookVerificationToken(): string {
  return (process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN || "").trim();
}

export function getNotionTelegramBotToken(): string {
  return (process.env.TELEGRAM_NOTION_BOT_TOKEN || "").trim();
}

export function getDefaultTelegramChatId(): bigint | null {
  const raw = (process.env.DEFAULT_TELEGRAM_CHAT_ID || "").trim();
  if (!/^-?\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function notionEnvFlags() {
  return {
    notionToken: Boolean(getNotionToken()),
    verificationToken: Boolean(getNotionWebhookVerificationToken()),
    telegramBotToken: Boolean(getNotionTelegramBotToken()),
    defaultChatId: getDefaultTelegramChatId() != null,
  };
}
