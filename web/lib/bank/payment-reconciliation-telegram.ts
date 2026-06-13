import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage, answerCallbackQuery, editMessageText } from "@/lib/telegram/api";
import { getAdminChatIds, getDirectRemindersBotToken } from "@/lib/direct-reminders/telegram";
import {
  ignoreBankAltegioPayment,
  reconcileBankAltegioPayments,
} from "@/lib/bank/altegio-payment-reconcile";

const TELEGRAM_TOKEN_PREFIX = "bank:payment-reconcile:telegram:token:";
const TELEGRAM_OUTGOING_LOG = "bank:payment-reconcile:telegram:outgoing";
const TELEGRAM_CALLBACK_LOG = "bank:payment-reconcile:telegram:callbacks";

type TelegramTokenPayload = {
  bankStatementItemId: string;
  purposeIds: string[];
  createdAt: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatKopiykas(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const hryvnias = abs / 100n;
  const kopiykas = abs % 100n;
  return `${sign}${hryvnias.toString()}.${kopiykas.toString().padStart(2, "0")} грн`;
}

function makeToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function writeTelegramLog(key: string, payload: object) {
  try {
    await kvWrite.lpush(key, JSON.stringify({ at: new Date().toISOString(), ...payload }));
    await kvWrite.ltrim(key, 0, 499);
  } catch (error) {
    console.warn("[payment-reconciliation-telegram] Не вдалося записати KV лог:", error);
  }
}

async function saveToken(token: string, payload: TelegramTokenPayload) {
  await kvWrite.setRaw(`${TELEGRAM_TOKEN_PREFIX}${token}`, JSON.stringify(payload));
}

async function loadToken(token: string): Promise<TelegramTokenPayload | null> {
  const raw = await kvRead.getRaw(`${TELEGRAM_TOKEN_PREFIX}${token}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.bankStatementItemId !== "string" || !Array.isArray(parsed.purposeIds)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function notifyBankPaymentNeedsReview(bankStatementItemId: string) {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    include: {
      account: {
        select: {
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
        },
      },
      altegioPaymentMatch: true,
    },
  });

  if (!statement) {
    throw new Error("Банківську операцію не знайдено");
  }
  if (statement.amount >= 0n || statement.hold) {
    throw new Error("Telegram-повідомлення надсилаються лише для фінальних вихідних платежів");
  }
  if (statement.altegioPaymentMatch?.telegramNotifiedAt) {
    return { ok: true, skipped: true, reason: "already_notified" };
  }

  const purposes = await (prisma as any).altegioPaymentPurpose.findMany({
    where: { isActive: true },
    orderBy: { title: "asc" },
    take: 8,
    select: { id: true, title: true },
  });

  const token = makeToken();
  await saveToken(token, {
    bankStatementItemId,
    purposeIds: purposes.map((purpose: any) => purpose.id),
    createdAt: new Date().toISOString(),
  });

  const accountLabel =
    statement.account.altegioAccountTitle ||
    statement.account.maskedPan ||
    statement.account.iban ||
    "Банківський рахунок";

  const message = [
    "<b>Потрібно звести вихідний банківський платіж</b>",
    "",
    `<b>Дата:</b> ${escapeHtml(statement.time.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
    `<b>Рахунок:</b> ${escapeHtml(accountLabel)}`,
    `<b>Сума:</b> ${escapeHtml(formatKopiykas(statement.amount))}`,
    statement.counterName ? `<b>Контрагент:</b> ${escapeHtml(statement.counterName)}` : null,
    statement.comment ? `<b>Призначення банку:</b> ${escapeHtml(statement.comment)}` : null,
    statement.description ? `<b>Опис:</b> ${escapeHtml(statement.description)}` : null,
    "",
    "Оберіть призначення платежу Altegio або відкладіть розбір у таблицю зведення.",
  ].filter(Boolean).join("\n");

  const purposeButtons = purposes.map((purpose: any, index: number) => [
    { text: purpose.title.slice(0, 48), callback_data: `bank_payment:${token}:p${index}` },
  ]);
  const keyboard = {
    inline_keyboard: [
      ...purposeButtons,
      [
        { text: "Відкласти", callback_data: `bank_payment:${token}:later` },
        { text: "Ігнорувати", callback_data: `bank_payment:${token}:ignore` },
      ],
    ],
  };

  const chatIds = await getAdminChatIds();
  const botToken = getDirectRemindersBotToken();
  let sent = 0;
  for (const chatId of chatIds) {
    const telegramMessage = await sendMessage(chatId, message, { reply_markup: keyboard }, botToken);
    sent += 1;
    await writeTelegramLog(TELEGRAM_OUTGOING_LOG, {
      bankStatementItemId,
      chatId,
      token,
      telegramMessage,
    });
  }

  await (prisma as any).bankAltegioPaymentMatch.upsert({
    where: { bankStatementItemId },
    create: {
      bankStatementItemId,
      status: "needs_review",
      matchType: "telegram",
      reviewNote: "Відправлено адміністратору в Telegram",
      telegramNotifiedAt: new Date(),
    },
    update: {
      telegramNotifiedAt: new Date(),
      matchType: "telegram",
      reviewNote: "Відправлено адміністратору в Telegram",
    },
  });

  return { ok: true, sent, token };
}

export async function notifyUnmatchedBankPayments(limit = 10) {
  const matches = await (prisma as any).bankAltegioPaymentMatch.findMany({
    where: {
      status: "needs_review",
      telegramNotifiedAt: null,
      bankStatementItem: {
        amount: { lt: 0 },
        hold: false,
      },
    },
    select: { bankStatementItemId: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results = [];
  for (const match of matches) {
    results.push(await notifyBankPaymentNeedsReview(match.bankStatementItemId));
  }
  return { ok: true, processed: results.length, results };
}

export async function handleBankPaymentTelegramCallback(callback: {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
}): Promise<boolean> {
  const data = callback.data || "";
  if (!data.startsWith("bank_payment:")) return false;

  const botToken = getDirectRemindersBotToken();
  const [, token, action] = data.split(":");
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  const payload = token ? await loadToken(token) : null;

  if (!payload || !chatId || !messageId) {
    await answerCallbackQuery(callback.id, { text: "Дія застаріла або не знайдена", show_alert: true }, botToken);
    return true;
  }

  await writeTelegramLog(TELEGRAM_CALLBACK_LOG, {
    token,
    action,
    bankStatementItemId: payload.bankStatementItemId,
    from: callback.from,
  });

  if (action === "ignore") {
    await ignoreBankAltegioPayment(payload.bankStatementItemId, "Ігноровано з Telegram");
    await answerCallbackQuery(callback.id, { text: "Платіж ігноровано" }, botToken);
    await editMessageText(chatId, messageId, "Платіж позначено як ігнорований у зведенні.", {}, botToken);
    return true;
  }

  if (action === "later") {
    await answerCallbackQuery(callback.id, { text: "Залишено для ручного розбору" }, botToken);
    await editMessageText(chatId, messageId, "Платіж залишено у статусі ручного розбору в таблиці зведення.", {}, botToken);
    return true;
  }

  if (action?.startsWith("p")) {
    const index = Number(action.slice(1));
    const purposeId = payload.purposeIds[index];
    const purpose = purposeId
      ? await (prisma as any).altegioPaymentPurpose.findUnique({ where: { id: purposeId } })
      : null;

    if (!purpose) {
      await answerCallbackQuery(callback.id, { text: "Призначення не знайдено", show_alert: true }, botToken);
      return true;
    }

    await (prisma as any).bankAltegioPendingPayment.upsert({
      where: { bankStatementItemId: payload.bankStatementItemId },
      create: {
        bankStatementItemId: payload.bankStatementItemId,
        purposeId: purpose.id,
        purposeTitle: purpose.title,
        status: "awaiting_altegio_document",
        createdFrom: "telegram",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      },
      update: {
        purposeId: purpose.id,
        purposeTitle: purpose.title,
        status: "awaiting_altegio_document",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      },
    });

    await (prisma as any).bankAltegioPaymentMatch.upsert({
      where: { bankStatementItemId: payload.bankStatementItemId },
      create: {
        bankStatementItemId: payload.bankStatementItemId,
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо документ Altegio для призначення: ${purpose.title}`,
      },
      update: {
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо документ Altegio для призначення: ${purpose.title}`,
      },
    });

    await reconcileBankAltegioPayments({ limit: 50 });
    await answerCallbackQuery(callback.id, { text: "Призначення збережено" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      `Збережено призначення: <b>${escapeHtml(purpose.title)}</b>\n\nОчікуємо відповідний документ Altegio і автоматично прив'яжемо його за сумою, рахунком та призначенням.`,
      {},
      botToken,
    );
    return true;
  }

  await answerCallbackQuery(callback.id, { text: "Невідома дія платежу", show_alert: true }, botToken);
  return true;
}
