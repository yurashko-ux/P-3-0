// Telegram-повідомлення власниці для підтвердження інкасації.

import { sendMessage, answerCallbackQuery, editMessageText } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  bucketLabelUa,
  type EncashmentAccountBucket,
} from "@/lib/finance/encashment-account-bucket";
import { confirmEncashmentByOwner } from "@/lib/finance/encashment-confirmation";

export const ENCASHMENT_CONFIRM_OWNER_PREFIX = "encashment_confirm:owner:";

const MONTH_NAMES_UA = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

function getReportsBotToken(): string {
  const token = TELEGRAM_ENV.REPORTS_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_REPORTS_BOT_TOKEN");
  return token;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatOperationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });
}

function monthLabelUa(month: number): string {
  return MONTH_NAMES_UA[month - 1] || String(month);
}

export async function sendEncashmentOwnerTelegram(params: {
  confirmationId: string;
  year: number;
  month: number;
  accountTitle: string;
  bucket: EncashmentAccountBucket;
  displayAmount: string;
  operationDate: string;
  ownerChatIds: number[];
}): Promise<Array<{ chatId: number; messageId: number }>> {
  const botToken = getReportsBotToken();
  const bucketLabel = bucketLabelUa(params.bucket);
  const text = [
    "<b>Інкасація — підтвердіть отримання коштів</b>",
    "",
    `<b>Рахунок:</b> ${escapeHtml(params.accountTitle)} (${escapeHtml(bucketLabel)})`,
    `<b>Сума:</b> ${escapeHtml(params.displayAmount)}`,
    `<b>Дата:</b> ${escapeHtml(formatOperationDate(params.operationDate))}`,
    `<b>Період звіту:</b> ${escapeHtml(monthLabelUa(params.month))} ${params.year}`,
  ].join("\n");

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "Підтвердити отримання",
          callback_data: `${ENCASHMENT_CONFIRM_OWNER_PREFIX}${params.confirmationId}`,
        },
      ],
    ],
  };

  const results: Array<{ chatId: number; messageId: number }> = [];

  for (const chatId of params.ownerChatIds) {
    const response = (await sendMessage(chatId, text, { reply_markup: keyboard }, botToken)) as {
      message_id?: number;
    };
    const messageId = response?.message_id;
    if (messageId) {
      results.push({ chatId, messageId });
    }
  }

  return results;
}

export async function handleEncashmentOwnerTelegramCallback(callback: {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
  from?: { id: number };
}): Promise<boolean> {
  const data = callback.data || "";
  if (!data.startsWith(ENCASHMENT_CONFIRM_OWNER_PREFIX)) return false;

  const botToken = getReportsBotToken();
  const confirmationId = data.slice(ENCASHMENT_CONFIRM_OWNER_PREFIX.length);
  const chatId = callback.message?.chat.id ?? callback.from?.id;

  if (!confirmationId || !chatId) {
    await answerCallbackQuery(callback.id, { text: "Некоректні дані", show_alert: true }, botToken);
    return true;
  }

  const result = await confirmEncashmentByOwner({
    confirmationId,
    ownerChatId: chatId,
  });

  if (!result.ok) {
    await answerCallbackQuery(callback.id, { text: result.error || "Помилка", show_alert: true }, botToken);
    return true;
  }

  await answerCallbackQuery(callback.id, { text: "Підтверджено ✓" }, botToken);

  if (callback.message) {
    await editMessageText(
      callback.message.chat.id,
      callback.message.message_id,
      [
        "<b>Інкасація — підтвердіть отримання коштів</b>",
        "",
        "✅ <b>Підтверджено отримання коштів</b>",
      ].join("\n"),
      {},
      botToken,
    ).catch(() => undefined);
  }

  return true;
}
