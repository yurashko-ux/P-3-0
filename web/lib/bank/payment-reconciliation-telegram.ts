import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage, answerCallbackQuery, editMessageText, deleteMessage } from "@/lib/telegram/api";
import { getDirectRemindersBotToken } from "@/lib/direct-reminders/telegram";
import {
  ignoreBankAltegioPayment,
  reconcileBankAltegioPayments,
} from "@/lib/bank/altegio-payment-reconcile";

const TELEGRAM_TOKEN_PREFIX = "bank:payment-reconcile:telegram:token:";
const TELEGRAM_OUTGOING_LOG = "bank:payment-reconcile:telegram:outgoing";
const TELEGRAM_CALLBACK_LOG = "bank:payment-reconcile:telegram:callbacks";
const PAYMENT_RECONCILIATION_TEST_USERNAME = "mykolay";

type TelegramTokenPayload = {
  bankStatementItemId: string;
  purposeIds: string[];
  createdAt: string;
};

type PaymentTelegramOutgoingLogEntry = {
  at?: string;
  chatId?: number;
  messageId?: number;
  telegramMessageId?: number;
  bankStatementItemId?: string;
  telegramMessage?: {
    message_id?: number;
    chat?: { id?: number };
  };
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

function kyivYmdFromDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function yesterdayKyivYmd(): string {
  const now = new Date();
  return kyivYmdFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

function parsePaymentTelegramLogEntry(raw: string): PaymentTelegramOutgoingLogEntry | null {
  let value: unknown = raw;
  for (let i = 0; i < 4; i += 1) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        return null;
      }
    }
    if (value && typeof value === "object" && "value" in value && typeof (value as { value?: unknown }).value === "string") {
      value = (value as { value: string }).value;
      continue;
    }
    break;
  }
  return value && typeof value === "object" ? (value as PaymentTelegramOutgoingLogEntry) : null;
}

function getPaymentTelegramMessageRef(entry: PaymentTelegramOutgoingLogEntry): { chatId: number; messageId: number } | null {
  const chatId = Number(entry.chatId ?? entry.telegramMessage?.chat?.id);
  const messageId = Number(entry.telegramMessage?.message_id ?? entry.messageId ?? entry.telegramMessageId);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) return null;
  return { chatId, messageId };
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

async function getPaymentReconciliationTestChatIds(): Promise<number[]> {
  const masters = await prisma.directMaster.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      role: true,
      telegramUsername: true,
      telegramChatId: true,
    },
  });

  const mykolay = masters.find((master) => {
    const username = String(master.telegramUsername || "").trim().replace(/^@/, "").toLowerCase();
    const name = String(master.name || "").trim().toLowerCase();
    return username === PAYMENT_RECONCILIATION_TEST_USERNAME || name.includes("mykolay") || name.includes("миколай");
  });

  if (!mykolay?.telegramChatId) {
    console.warn("[payment-reconciliation-telegram] Тестовий отримувач Telegram не знайдений або без chatId", {
      username: PAYMENT_RECONCILIATION_TEST_USERNAME,
      candidates: masters.map((master) => ({
        id: master.id,
        name: master.name,
        role: master.role,
        telegramUsername: master.telegramUsername,
        hasChatId: master.telegramChatId != null,
      })),
    });
    return [];
  }

  const chatId = Number(mykolay.telegramChatId);
  if (!Number.isFinite(chatId)) {
    throw new Error(`Некоректний Telegram chatId для тестового отримувача ${PAYMENT_RECONCILIATION_TEST_USERNAME}`);
  }

  console.log("[payment-reconciliation-telegram] Тестовий режим: відправляємо тільки Mykolay", {
    id: mykolay.id,
    name: mykolay.name,
    role: mykolay.role,
    telegramUsername: mykolay.telegramUsername,
    chatId,
  });

  return [chatId];
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

  const chatIds = await getPaymentReconciliationTestChatIds();
  if (chatIds.length === 0) {
    throw new Error(`Не знайдено Telegram chatId для тестового отримувача @${PAYMENT_RECONCILIATION_TEST_USERNAME}`);
  }
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

export async function deletePaymentReconciliationTelegramMessages(params: {
  day?: string;
  dryRun?: boolean;
  limit?: number;
} = {}) {
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : yesterdayKyivYmd();
  const dryRun = params.dryRun === true;
  const limit = Math.max(1, Math.min(params.limit ?? 500, 1000));
  const botToken = getDirectRemindersBotToken();
  const rawEntries = await kvRead.lrange(TELEGRAM_OUTGOING_LOG, 0, limit - 1);
  const seen = new Set<string>();
  const targets: Array<{ chatId: number; messageId: number; bankStatementItemId: string | null }> = [];

  for (const raw of rawEntries) {
    const entry = parsePaymentTelegramLogEntry(raw);
    if (!entry?.at || kyivYmdFromDate(new Date(entry.at)) !== day) continue;
    const ref = getPaymentTelegramMessageRef(entry);
    if (!ref) continue;
    const key = `${ref.chatId}:${ref.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      ...ref,
      bankStatementItemId: entry.bankStatementItemId ?? null,
    });
  }

  let deleted = 0;
  let failed = 0;
  const failures: Array<{ chatId: number; messageId: number; error: string }> = [];

  if (!dryRun) {
    for (const target of targets) {
      try {
        await deleteMessage(target.chatId, target.messageId, botToken);
        deleted += 1;
      } catch (error) {
        failed += 1;
        failures.push({
          chatId: target.chatId,
          messageId: target.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const bankStatementItemIds = Array.from(
      new Set(targets.map((target) => target.bankStatementItemId).filter((value): value is string => Boolean(value))),
    );
    if (bankStatementItemIds.length > 0) {
      await (prisma as any).bankAltegioPaymentMatch.updateMany({
        where: { bankStatementItemId: { in: bankStatementItemIds } },
        data: {
          telegramNotifiedAt: null,
          reviewNote: "Telegram-повідомлення тестового періоду видалено",
        },
      });
    }
  }

  return {
    ok: failed === 0,
    day,
    dryRun,
    scanned: rawEntries.length,
    targets: targets.length,
    deleted,
    failed,
    failures,
  };
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
