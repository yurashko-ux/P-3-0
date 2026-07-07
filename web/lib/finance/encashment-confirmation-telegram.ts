// Telegram-повідомлення власниці для підтвердження інкасації.

import { sendMessage, answerCallbackQuery, editMessageText } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  bucketLabelUa,
  formatEncashmentAmount,
  type EncashmentAccountBucket,
} from "@/lib/finance/encashment-account-bucket";
import {
  formatEncashmentReceiptDisplayUah,
  formatEncashmentReceiptDisplayReceived,
  formatEncashmentReceiptDisplayPending,
  type EncashmentReceiptDisplay,
} from "@/lib/finance/encashment-receipt-totals";
import {
  confirmEncashmentByOwner,
  fetchEncashmentReceiptSyncData,
} from "@/lib/finance/encashment-confirmation";
import { buildEncashmentReceiptDisplay } from "@/lib/finance/encashment-receipt-totals";

export const ENCASHMENT_CONFIRM_OWNER_PREFIX = "encashment_confirm:owner:";

const MONTH_NAMES_UA = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

type EncashmentTelegramMessageParams = {
  confirmationId: string;
  accountTitle: string;
  bucket: EncashmentAccountBucket;
  displayAmount: string;
  operationDate: string;
  year: number;
  month: number;
  receiptDisplay: EncashmentReceiptDisplay;
  confirmed: boolean;
};

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

function buildReceiptTotalsBlock(receiptDisplay: EncashmentReceiptDisplay): string[] {
  return [
    "",
    `<b>Сума інкасації:</b> ${escapeHtml(formatEncashmentReceiptDisplayUah(receiptDisplay.totalUah))}`,
    `<b>Отримано:</b> ${escapeHtml(formatEncashmentReceiptDisplayReceived(receiptDisplay))}`,
    `<b>Ще буде отримано:</b> ${escapeHtml(formatEncashmentReceiptDisplayPending(receiptDisplay))}`,
  ];
}

export function buildEncashmentOwnerTelegramMessage(
  params: EncashmentTelegramMessageParams,
): { text: string; keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const bucketLabel = bucketLabelUa(params.bucket);
  const lines = [
    "<b>Інкасація — підтвердіть отримання коштів</b>",
    "",
  ];

  if (params.confirmed) {
    lines.push("✅ <b>Підтверджено отримання коштів</b>", "");
  }

  lines.push(
    `<b>Рахунок:</b> ${escapeHtml(params.accountTitle)} (${escapeHtml(bucketLabel)})`,
    `<b>Сума:</b> ${escapeHtml(params.displayAmount)}`,
    `<b>Дата:</b> ${escapeHtml(formatOperationDate(params.operationDate))}`,
    `<b>Період звіту:</b> ${escapeHtml(monthLabelUa(params.month))} ${params.year}`,
    ...buildReceiptTotalsBlock(params.receiptDisplay),
  );

  if (params.confirmed) {
    return { text: lines.join("\n") };
  }

  return {
    text: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          {
            text: "Підтвердити отримання",
            callback_data: `${ENCASHMENT_CONFIRM_OWNER_PREFIX}${params.confirmationId}`,
          },
        ],
      ],
    },
  };
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
  receiptDisplay: EncashmentReceiptDisplay;
}): Promise<Array<{ chatId: number; messageId: number }>> {
  const botToken = getReportsBotToken();
  const { text, keyboard } = buildEncashmentOwnerTelegramMessage({
    confirmationId: params.confirmationId,
    accountTitle: params.accountTitle,
    bucket: params.bucket,
    displayAmount: params.displayAmount,
    operationDate: params.operationDate,
    year: params.year,
    month: params.month,
    receiptDisplay: params.receiptDisplay,
    confirmed: false,
  });

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

function formatConfirmationDisplayAmountFromRow(row: {
  accountBucket: string;
  amountKopiykas: bigint;
  foreignAmount: { toString(): string } | null;
}): string {
  const bucket = row.accountBucket as EncashmentAccountBucket;
  const amountUAH = Number(row.amountKopiykas) / 100;
  const foreignRaw = row.foreignAmount != null ? Number(row.foreignAmount) : null;
  const foreign = foreignRaw != null && Number.isFinite(foreignRaw) ? foreignRaw : null;

  if (bucket === "usd") {
    const amt = foreign != null && foreign > 0 ? foreign : amountUAH;
    return `${formatEncashmentAmount(amt)} $`;
  }
  if (bucket === "eur") {
    const amt = foreign != null && foreign > 0 ? foreign : amountUAH;
    return `${formatEncashmentAmount(amt)} EUR`;
  }
  return `${formatEncashmentAmount(amountUAH)} грн.`;
}

export async function syncEncashmentOwnerTelegramMessagesForPeriod(
  year: number,
  month: number,
  options?: { onlyConfirmationId?: string },
): Promise<void> {
  const botToken = getReportsBotToken();
  const { totalEncashmentUah, payments, confirmations } = await fetchEncashmentReceiptSyncData(
    year,
    month,
  );

  for (const row of confirmations) {
    if (
      row.status === "owner_confirmed" &&
      row.id !== options?.onlyConfirmationId
    ) {
      continue;
    }

    const chatId = Number(row.telegramOwnerChatId);
    const messageId = row.telegramOwnerMessageId;
    if (!chatId || !messageId) continue;

    const isConfirmed = row.status === "owner_confirmed";
    const asOfConfirmedAt =
      isConfirmed && row.ownerConfirmedAt ? row.ownerConfirmedAt.toISOString() : null;
    const receiptDisplay = buildEncashmentReceiptDisplay(
      totalEncashmentUah,
      payments,
      asOfConfirmedAt,
    );

    const { text, keyboard } = buildEncashmentOwnerTelegramMessage({
      confirmationId: row.id,
      accountTitle: row.accountTitle || "—",
      bucket: row.accountBucket as EncashmentAccountBucket,
      displayAmount: formatConfirmationDisplayAmountFromRow(row),
      operationDate: row.operationDate.toISOString().slice(0, 10),
      year: row.reportYear,
      month: row.reportMonth,
      receiptDisplay,
      confirmed: isConfirmed,
    });

    await editMessageText(
      chatId,
      messageId,
      text,
      keyboard ? { reply_markup: keyboard } : { reply_markup: { inline_keyboard: [] } },
      botToken,
    ).catch((err) => {
      console.error(
        `[encashment-confirmation-telegram] edit message ${messageId} chat ${chatId}:`,
        err,
      );
    });
  }
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

  if (result.year != null && result.month != null) {
    await syncEncashmentOwnerTelegramMessagesForPeriod(result.year, result.month, {
      onlyConfirmationId: confirmationId,
    }).catch((err) => {
      console.error("[encashment-confirmation-telegram] sync after confirm error:", err);
    });
  }

  return true;
}
