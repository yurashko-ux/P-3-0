import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage, answerCallbackQuery, editMessageText, deleteMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  ignoreBankAltegioPayment,
  reconcileBankAltegioPayments,
} from "@/lib/bank/altegio-payment-reconcile";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";

const TELEGRAM_TOKEN_PREFIX = "bank:payment-reconcile:telegram:token:";
const TELEGRAM_OUTGOING_LOG = "bank:payment-reconcile:telegram:outgoing";
const TELEGRAM_CALLBACK_LOG = "bank:payment-reconcile:telegram:callbacks";
const PAYMENT_RECONCILIATION_TEST_USERNAME = "mykolay";
const ALTEGIO_PAYMENT_PURPOSE_ALLOWLIST = [
  "Інвестиції в салон",
  "Інкасація",
  "Інструменти салону",
  "Інтернет, CRM, IP і т. д.",
  "Інші витрати",
  "Інші доходи",
  "Балансування рахунку",
  "Бухгалтерія",
  "Доставка товарів ( Нова Пошта)",
  "Дірект",
  "Завдатки клієнтів які не прийшли",
  "Закупівля матеріалів",
  "Закупівля товарів",
  "Зарплата співробітникам",
  "Канцелярські, миючі товари та засоби",
  "Комісійні % за продаж волосся",
  "Комісія за еквайринг",
  "Маркетинг CMM",
  "Надання послуг",
  "Оренда",
  "Переміщення",
  "Повернення",
  "Податки та збори",
  "Поповнення рахунку",
  "Прибирання Салону",
  "Продаж абонементів",
  "Продаж сертифікатів",
  "Продаж товарів",
  "Продукти для гостей",
  "Реклама, Бюджет, ФБ",
  "Ремонт обладнання, інструментів",
  "Таргет оплата роботи маркетологів",
  "Управління",
] as const;

type TelegramTokenPayload = {
  bankStatementItemId: string;
  purposeIds: string[];
  accountIds?: string[];
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

function chunkKeyboardButtons<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

function normalizePurposeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}

function canonicalPurposeTitle(value: string): string | null {
  const key = normalizePurposeKey(value);
  return ALTEGIO_PAYMENT_PURPOSE_ALLOWLIST.find((title) => normalizePurposeKey(title) === key) ?? null;
}

async function getTelegramPaymentPurposes(): Promise<Array<{ id: string; title: string }>> {
  const existing = await (prisma as any).altegioPaymentPurpose.findMany({
    where: { isActive: true },
    select: { id: true, title: true },
    take: 500,
  });
  const byCanonicalTitle = new Map<string, { id: string; title: string }>();

  for (const purpose of existing) {
    const canonical = canonicalPurposeTitle(String(purpose.title || ""));
    if (!canonical || byCanonicalTitle.has(canonical)) continue;
    byCanonicalTitle.set(canonical, { id: purpose.id, title: canonical });
  }

  const result: Array<{ id: string; title: string }> = [];
  for (const title of ALTEGIO_PAYMENT_PURPOSE_ALLOWLIST) {
    const existingPurpose = byCanonicalTitle.get(title);
    if (existingPurpose) {
      result.push(existingPurpose);
      continue;
    }

    const normalizedTitle = normalizePurposeKey(title);
    const created = await (prisma as any).altegioPaymentPurpose.upsert({
      where: { companyId_normalizedTitle: { companyId: "1169323", normalizedTitle } },
      create: {
        companyId: "1169323",
        title,
        normalizedTitle,
        source: "manual_altegio_payment_purpose_allowlist",
        isActive: true,
        syncedAt: new Date(),
      },
      update: {
        title,
        source: "manual_altegio_payment_purpose_allowlist",
        isActive: true,
        syncedAt: new Date(),
      },
      select: { id: true, title: true },
    });
    result.push({ id: created.id, title: created.title });
  }

  return result;
}

function buildPaymentPurposeKeyboard(purposes: Array<{ title: string }>, token: string) {
  const purposeButtons = purposes.map((purpose, index: number) => ({
    text: purpose.title.slice(0, 48),
    callback_data:
      canonicalPurposeTitle(purpose.title) === "Переміщення"
        ? `bank_payment:${token}:transfer`
        : `bank_payment:${token}:p${index}`,
  }));

  return {
    inline_keyboard: [
      ...chunkKeyboardButtons(purposeButtons, 2),
      [
        { text: "Відкласти", callback_data: `bank_payment:${token}:later` },
        { text: "Ігнорувати", callback_data: `bank_payment:${token}:ignore` },
      ],
    ],
  };
}

async function getAltegioTransferTargetAccounts(bankStatementItemId: string): Promise<Array<{ id: string; title: string }>> {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    select: {
      account: {
        select: {
          altegioAccountId: true,
        },
      },
    },
  });
  const sourceAltegioAccountId = statement?.account.altegioAccountId ?? null;

  try {
    const altegioAccounts = await fetchAltegioAccounts();
    const liveAccounts = altegioAccounts
      .filter((account) => account.id && account.id !== sourceAltegioAccountId)
      .map((account) => ({
        id: account.id,
        title: account.title || `Рахунок ${account.id}`,
      }));
    if (liveAccounts.length > 0) {
      return liveAccounts;
    }
  } catch (error) {
    console.warn("[payment-reconciliation-telegram] Не вдалося отримати рахунки Altegio для переміщення:", error);
  }

  const accounts = await prisma.bankAccount.findMany({
    where: {
      currencyCode: 980,
      altegioAccountId: { not: null },
    },
    select: {
      altegioAccountId: true,
      altegioAccountTitle: true,
    },
    orderBy: [{ altegioAccountTitle: "asc" }],
  });

  const seen = new Set<string>();
  const result: Array<{ id: string; title: string }> = [];
  for (const account of accounts) {
    const id = account.altegioAccountId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (sourceAltegioAccountId && id === sourceAltegioAccountId) continue;
    result.push({
      id,
      title: account.altegioAccountTitle || `Рахунок ${id}`,
    });
  }

  return result;
}

function getPaymentReconciliationBotToken(): string {
  const token = TELEGRAM_ENV.PAYMENTS_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing TELEGRAM_PAYMENTS_BOT_TOKEN env variable for payment reconciliation bot");
  }
  return token;
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

async function getPaymentReconciliationChatIds(): Promise<number[]> {
  if (TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS.length > 0) {
    console.log("[payment-reconciliation-telegram] Відправляємо через payment-бота на TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS", {
      count: TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS.length,
    });
    return TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS;
  }

  console.warn(
    "[payment-reconciliation-telegram] TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS не задано, тимчасово використовуємо Mykolay з DirectMaster",
  );
  return getPaymentReconciliationTestChatIds();
}

export async function notifyBankPaymentNeedsReview(bankStatementItemId: string, options: { force?: boolean } = {}) {
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
  if (statement.altegioPaymentMatch?.telegramNotifiedAt && !options.force) {
    return { ok: true, skipped: true, reason: "already_notified" };
  }

  const purposes = await getTelegramPaymentPurposes();

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

  const keyboard = {
    inline_keyboard: buildPaymentPurposeKeyboard(purposes, token).inline_keyboard,
  };

  const chatIds = await getPaymentReconciliationChatIds();
  if (chatIds.length === 0) {
    throw new Error("Не знайдено Telegram chatId для payment-бота. Додайте TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS або chatId для Mykolay.");
  }
  const botToken = getPaymentReconciliationBotToken();
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
  const botToken = getPaymentReconciliationBotToken();
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

  const botToken = getPaymentReconciliationBotToken();
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

  if (action === "transfer") {
    const accounts = await getAltegioTransferTargetAccounts(payload.bankStatementItemId);
    if (accounts.length === 0) {
      await answerCallbackQuery(callback.id, { text: "Немає доступних рахунків Altegio для переміщення", show_alert: true }, botToken);
      return true;
    }

    await saveToken(token, {
      ...payload,
      accountIds: accounts.map((account) => account.id),
    });

    const accountButtons = accounts.map((account, index) => ({
      text: account.title.slice(0, 48),
      callback_data: `bank_payment:${token}:a${index}`,
    }));

    await answerCallbackQuery(callback.id, { text: "Оберіть рахунок переміщення" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      "Оберіть рахунок Altegio, на який переміщаємо кошти:",
      {
        reply_markup: {
          inline_keyboard: [
            ...chunkKeyboardButtons(accountButtons, 2),
            [{ text: "Назад до статей", callback_data: `bank_payment:${token}:back` }],
          ],
        },
      },
      botToken,
    );
    return true;
  }

  if (action === "back") {
    const purposes = await getTelegramPaymentPurposes();
    await saveToken(token, {
      bankStatementItemId: payload.bankStatementItemId,
      purposeIds: purposes.map((purpose: any) => purpose.id),
      createdAt: payload.createdAt,
    });

    await answerCallbackQuery(callback.id, { text: "Оберіть статтю платежу" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      "Оберіть призначення платежу Altegio або відкладіть розбір у таблицю зведення.",
      { reply_markup: buildPaymentPurposeKeyboard(purposes, token) },
      botToken,
    );
    return true;
  }

  if (action?.startsWith("a")) {
    const index = Number(action.slice(1));
    const accountId = payload.accountIds?.[index];
    if (!accountId) {
      await answerCallbackQuery(callback.id, { text: "Рахунок переміщення не знайдено", show_alert: true }, botToken);
      return true;
    }

    const accounts = await getAltegioTransferTargetAccounts(payload.bankStatementItemId);
    const account = accounts.find((item) => item.id === accountId);
    const accountTitle = account?.title || `Рахунок ${accountId}`;
    const purposeTitle = `Переміщення -> ${accountTitle}`;

    await (prisma as any).bankAltegioPendingPayment.upsert({
      where: { bankStatementItemId: payload.bankStatementItemId },
      create: {
        bankStatementItemId: payload.bankStatementItemId,
        purposeTitle,
        status: "awaiting_altegio_document",
        createdFrom: "telegram",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
        note: `Переміщення на рахунок Altegio ${accountTitle} (${accountId})`,
      },
      update: {
        purposeId: null,
        purposeTitle,
        status: "awaiting_altegio_document",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
        note: `Переміщення на рахунок Altegio ${accountTitle} (${accountId})`,
      },
    });

    await (prisma as any).bankAltegioPaymentMatch.upsert({
      where: { bankStatementItemId: payload.bankStatementItemId },
      create: {
        bankStatementItemId: payload.bankStatementItemId,
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо переміщення Altegio на рахунок: ${accountTitle}`,
      },
      update: {
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо переміщення Altegio на рахунок: ${accountTitle}`,
      },
    });

    await reconcileBankAltegioPayments({ limit: 50 });
    await answerCallbackQuery(callback.id, { text: "Переміщення збережено" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      `Збережено: <b>${escapeHtml(purposeTitle)}</b>\n\nОчікуємо відповідне переміщення в Altegio і автоматично прив'яжемо його за сумою та рахунками.`,
      {},
      botToken,
    );
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
