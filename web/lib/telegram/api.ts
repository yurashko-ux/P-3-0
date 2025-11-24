import { assertTelegramEnv, telegramApiUrl, TELEGRAM_ENV } from "./env";

type TelegramRequestPayload = Record<string, unknown>;

type TelegramApiResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

async function telegramFetch<T = any>(
  method: string,
  payload: TelegramRequestPayload
): Promise<T> {
  assertTelegramEnv();

  const response = await fetch(telegramApiUrl(method), {
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
  extra: TelegramRequestPayload = {}
) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  };

  return telegramFetch("sendMessage", payload);
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
  options: TelegramRequestPayload = {}
) {
  const payload = {
    callback_query_id: callbackQueryId,
    ...options,
  };

  return telegramFetch("answerCallbackQuery", payload);
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

  // Відправляємо перше фото з підписом
  await sendPhoto(TELEGRAM_ENV.REPORT_GROUP_ID, photoFileIds[0], { caption });

  // Відправляємо решту фото без підпису
  for (let i = 1; i < photoFileIds.length; i++) {
    await sendPhoto(TELEGRAM_ENV.REPORT_GROUP_ID, photoFileIds[i]);
  }
}

