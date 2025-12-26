import { assertTelegramEnv, telegramApiUrl, TELEGRAM_ENV, assertDirectRemindersBotToken } from "./env";

type TelegramRequestPayload = Record<string, unknown>;

type TelegramApiResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

async function telegramFetch<T = any>(
  method: string,
  payload: TelegramRequestPayload,
  botToken?: string
): Promise<T> {
  const token = botToken || TELEGRAM_ENV.BOT_TOKEN;
  if (!token) {
    throw new Error("Missing Telegram bot token");
  }

  const response = await fetch(telegramApiUrl(method, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!data.ok) {
    throw new Error(
      `Telegram API error (${method}): ${data.description || "Unknown error"}`
    );
  }

  return data.result as T;
}

export function sendMessage(
  chatId: number,
  text: string,
  extra: TelegramRequestPayload = {},
  botToken?: string
) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  };

  return telegramFetch("sendMessage", payload, botToken);
}

export function sendPhoto(
  chatId: number,
  photo: string,
  extra: TelegramRequestPayload = {}
) {
  const payload = {
    chat_id: chatId,
    photo,
    ...extra,
  };

  return telegramFetch("sendPhoto", payload);
}

export function answerCallbackQuery(
  callbackQueryId: string,
  options: TelegramRequestPayload = {},
  botToken?: string
) {
  const payload = {
    callback_query_id: callbackQueryId,
    ...options,
  };

  return telegramFetch("answerCallbackQuery", payload, botToken);
}

export function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  extra: TelegramRequestPayload = {},
  botToken?: string
) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  };

  return telegramFetch("editMessageText", payload, botToken);
}

export async function forwardPhotoToReportGroup(
  photoFileId: string,
  caption: string
) {
  if (!TELEGRAM_ENV.REPORT_GROUP_ID) {
    console.warn(
      "[telegram] TELEGRAM_PHOTO_GROUP_ID not configured. Skipping forward."
    );
    return;
  }

  return sendPhoto(TELEGRAM_ENV.REPORT_GROUP_ID, photoFileId, { caption });
}

export async function forwardMultiplePhotosToReportGroup(
  photoFileIds: string[],
  caption: string
) {
  if (!TELEGRAM_ENV.REPORT_GROUP_ID) {
    console.warn(
      "[telegram] TELEGRAM_PHOTO_GROUP_ID not configured. Skipping forward."
    );
    return;
  }

  if (photoFileIds.length === 0) {
    return;
  }

  // Відправляємо всі фото без підпису, крім останнього
  for (let i = 0; i < photoFileIds.length - 1; i++) {
    await sendPhoto(TELEGRAM_ENV.REPORT_GROUP_ID, photoFileIds[i]);
  }

  // Відправляємо останнє фото з підписом
  await sendPhoto(TELEGRAM_ENV.REPORT_GROUP_ID, photoFileIds[photoFileIds.length - 1], { caption });
}

