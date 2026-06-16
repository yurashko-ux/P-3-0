import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage, answerCallbackQuery, editMessageText, deleteMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  ignoreBankAltegioPayment,
  reconcileBankAltegioPayments,
} from "@/lib/bank/altegio-payment-reconcile";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import {
  createAltegioExpenseFromPendingPayment,
  createAltegioTransferFromPendingPayment,
} from "@/lib/altegio/finance-transactions-create";
import {
  canonicalizeAltegioPaymentPurposeTitle,
  importAltegioPaymentPurposes,
} from "@/lib/altegio/payment-purpose-import";
import { normalizePaymentPurposeTitle } from "@/lib/altegio/finance-transactions-sync";

const TELEGRAM_TOKEN_PREFIX = "bank:payment-reconcile:telegram:token:";
const TELEGRAM_OUTGOING_LOG = "bank:payment-reconcile:telegram:outgoing";
const TELEGRAM_CALLBACK_LOG = "bank:payment-reconcile:telegram:callbacks";
const TELEGRAM_COMMENT_WAIT_PREFIX = "bank:payment-reconcile:telegram:comment-wait:";
const PAYMENT_RECONCILIATION_TEST_USERNAME = "mykolay";
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

type TelegramCommentWaitPayload = {
  bankStatementItemId: string;
  purposeTitle: string;
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

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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

function getBankAccountDisplayTitle(account: {
  altegioAccountTitle?: string | null;
  maskedPan?: string | null;
  iban?: string | null;
} | null | undefined): string {
  return account?.altegioAccountTitle || account?.maskedPan || account?.iban || "Банківський рахунок";
}

async function getTelegramPaymentPurposes(): Promise<Array<{ id: string; title: string }>> {
  let existing = await (prisma as any).altegioPaymentPurpose.findMany({
    where: { isActive: true, externalId: { not: null } },
    select: { id: true, title: true, externalId: true },
    take: 500,
  });

  if (existing.length === 0) {
    try {
      await importAltegioPaymentPurposes({ dryRun: false, maxPages: 5 });
      existing = await (prisma as any).altegioPaymentPurpose.findMany({
        where: { isActive: true, externalId: { not: null } },
        select: { id: true, title: true, externalId: true },
        take: 500,
      });
    } catch (error) {
      console.warn("[payment-reconciliation-telegram] Не вдалося автоматично імпортувати статті Altegio:", error);
    }
  }

  const byTitle = new Map<string, { id: string; title: string }>();
  for (const purpose of existing as Array<{ id: string; title: string; externalId: string | null }>) {
    const title = String(purpose.title || "").trim();
    const externalId = String(purpose.externalId || "").trim();
    if (!title || !externalId) continue;
    const canonicalTitle = canonicalizeAltegioPaymentPurposeTitle(title, externalId);
    const key = normalizePaymentPurposeTitle(canonicalTitle);
    if (!byTitle.has(key)) {
      byTitle.set(key, { id: purpose.id, title: canonicalTitle });
    }
  }

  return Array.from(byTitle.values()).sort((a, b) => a.title.localeCompare(b.title, "uk"));
}

function buildPaymentPurposeKeyboard(purposes: Array<{ title: string }>, token: string) {
  const purposeButtons = purposes.map((purpose, index: number) => ({
    text: purpose.title.slice(0, 48),
    callback_data: `bank_payment:${token}:p${index}`,
  }));

  return {
    inline_keyboard: [
      ...chunkKeyboardButtons(purposeButtons, 2),
      [{ text: "Переміщення", callback_data: `bank_payment:${token}:transfer` }],
      [
        { text: "Відкласти", callback_data: `bank_payment:${token}:later` },
        { text: "Ігнорувати", callback_data: `bank_payment:${token}:ignore` },
      ],
    ],
  };
}

function buildCommentOfferKeyboard(token: string) {
  return {
    inline_keyboard: [
      [
        { text: "Додати коментар", callback_data: `bank_payment:${token}:comment` },
        { text: "Без коментаря", callback_data: `bank_payment:${token}:comment_skip` },
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

async function saveCommentWait(chatId: number, payload: TelegramCommentWaitPayload) {
  await kvWrite.setRaw(`${TELEGRAM_COMMENT_WAIT_PREFIX}${chatId}`, JSON.stringify(payload));
}

async function clearCommentWait(chatId: number) {
  await kvWrite.setRaw(`${TELEGRAM_COMMENT_WAIT_PREFIX}${chatId}`, "");
}

async function loadCommentWait(chatId: number): Promise<TelegramCommentWaitPayload | null> {
  const raw = await kvRead.getRaw(`${TELEGRAM_COMMENT_WAIT_PREFIX}${chatId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.bankStatementItemId !== "string" || typeof parsed.purposeTitle !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

async function markAltegioCreationError(bankStatementItemId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await (prisma as any).bankAltegioPaymentMatch.upsert({
    where: { bankStatementItemId },
    create: {
      bankStatementItemId,
      status: "needs_review",
      matchType: "telegram",
      reviewNote: `Не вдалося створити платіж Altegio: ${message}`,
      conflictData: { altegioCreateError: message },
    },
    update: {
      status: "needs_review",
      matchType: "telegram",
      reviewNote: `Не вдалося створити платіж Altegio: ${message}`,
      conflictData: { altegioCreateError: message },
    },
  });
  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId },
    data: { status: "awaiting_altegio_document" },
  }).catch(() => null);
  return message;
}

async function createExpenseAndNotifyTelegram(params: {
  bankStatementItemId: string;
  chatId: number;
  comment?: string | null;
  createdAt?: Date;
  createdBy?: string | null;
}) {
  const botToken = getPaymentReconciliationBotToken();
  try {
    const result = await createAltegioExpenseFromPendingPayment({
      bankStatementItemId: params.bankStatementItemId,
      comment: params.comment,
      createdAt: params.createdAt,
      createdBy: params.createdBy,
    });
    await sendMessage(
      params.chatId,
      [
        result.reusedExisting ? "Платіж вже існував в Altegio і був прив'язаний." : "Платіж успішно створено в Altegio.",
        "",
        `<b>Altegio ID:</b> ${escapeHtml(result.transaction.altegioId)}`,
        `<b>Рахунок:</b> ${escapeHtml(result.transaction.accountTitle || result.transaction.accountId || "—")}`,
        `<b>Сума:</b> ${escapeHtml(formatKopiykas(result.transaction.amountKopiykas))}`,
        `<b>Дата Altegio:</b> ${escapeHtml(result.transaction.operationDate.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
        result.transaction.comment ? `<b>Коментар:</b> ${escapeHtml(result.transaction.comment)}` : null,
      ].filter(Boolean).join("\n"),
      {},
      botToken,
    );
    return result;
  } catch (error) {
    const message = await markAltegioCreationError(params.bankStatementItemId, error);
    await sendMessage(
      params.chatId,
      [
        "Не вдалося створити платіж в Altegio.",
        "",
        `<b>Помилка:</b> ${escapeHtml(message)}`,
        "",
        "Платіж залишено у таблиці зведення для ручного розбору.",
      ].join("\n"),
      {},
      botToken,
    );
    return null;
  }
}

async function guardExistingAltegioDocumentBeforeTelegram(bankStatementItemId: string): Promise<{
  shouldNotify: boolean;
  reason?: string;
}> {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    include: {
      account: {
        select: {
          altegioAccountId: true,
        },
      },
      altegioPaymentMatch: true,
    },
  });

  if (!statement) {
    throw new Error("Банківську операцію не знайдено");
  }

  await reconcileBankAltegioPayments({
    from: addDays(statement.time, -3).toISOString(),
    to: addDays(statement.time, 3).toISOString(),
    limit: 100,
  });

  const refreshedMatch = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { status: true, altegioFinanceTransactionId: true },
  });

  if (refreshedMatch?.altegioFinanceTransactionId || ["auto_matched", "manual_matched", "ignored"].includes(refreshedMatch?.status)) {
    return { shouldNotify: false, reason: "already_linked_or_ignored" };
  }

  const altegioAccountId = statement.account?.altegioAccountId;
  if (!altegioAccountId) {
    return { shouldNotify: true };
  }

  const amount = absBigint(BigInt(statement.amount));
  const candidates = await (prisma as any).altegioFinanceTransaction.findMany({
    where: {
      accountId: String(altegioAccountId),
      direction: { in: ["out", "transfer"] },
      deletedInAltegio: false,
      operationDate: { gte: addDays(statement.time, -2), lte: addDays(statement.time, 2) },
      OR: [{ amountKopiykas: amount }, { amountKopiykas: -amount }],
    },
    select: { id: true, altegioId: true },
    take: 5,
  });

  if (candidates.length > 0) {
    await (prisma as any).bankAltegioPaymentMatch.upsert({
      where: { bankStatementItemId },
      create: {
        bankStatementItemId,
        status: "conflict",
        matchType: "system",
        reviewNote: "Знайдено платіж Altegio з такою сумою/датою, Telegram не надсилаємо; потрібне ручне зведення",
        conflictData: { candidateIds: candidates.map((candidate: any) => candidate.id) },
      },
      update: {
        status: "conflict",
        matchType: "system",
        reviewNote: "Знайдено платіж Altegio з такою сумою/датою, Telegram не надсилаємо; потрібне ручне зведення",
        conflictData: { candidateIds: candidates.map((candidate: any) => candidate.id) },
      },
    });
    return { shouldNotify: false, reason: "altegio_document_exists" };
  }

  return { shouldNotify: true };
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

  const guard = await guardExistingAltegioDocumentBeforeTelegram(bankStatementItemId);
  if (!guard.shouldNotify) {
    return { ok: true, skipped: true, reason: guard.reason };
  }

  const purposes = await getTelegramPaymentPurposes();

  const token = makeToken();
  await saveToken(token, {
    bankStatementItemId,
    purposeIds: purposes.map((purpose: any) => purpose.id),
    createdAt: new Date().toISOString(),
  });

  const accountLabel = getBankAccountDisplayTitle(statement.account);

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
    "Оберіть статтю витрат Altegio, окремо натисніть «Переміщення» для переказу між рахунками, або відкладіть розбір у таблицю зведення.",
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
  const seen = new Set<string>();
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

  const bankStatementItemIds: string[] = [];
  for (const match of matches) {
    if (seen.has(match.bankStatementItemId)) continue;
    seen.add(match.bankStatementItemId);
    bankStatementItemIds.push(match.bankStatementItemId);
  }

  if (bankStatementItemIds.length < limit) {
    const statementsWithoutMatch = await prisma.bankStatementItem.findMany({
      where: {
        amount: { lt: 0 },
        hold: false,
        account: { includeInOperationsTable: true },
        altegioPaymentMatch: null,
      },
      select: { id: true },
      take: limit - bankStatementItemIds.length,
      orderBy: { time: "desc" },
    });

    for (const statement of statementsWithoutMatch) {
      if (seen.has(statement.id)) continue;
      seen.add(statement.id);
      bankStatementItemIds.push(statement.id);
    }
  }

  const results = [];
  for (const bankStatementItemId of bankStatementItemIds) {
    results.push(await notifyBankPaymentNeedsReview(bankStatementItemId));
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

  if (action === "comment") {
    const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
      where: { bankStatementItemId: payload.bankStatementItemId },
      select: { purposeTitle: true },
    });
    if (!pending) {
      await answerCallbackQuery(callback.id, { text: "Спочатку оберіть статтю платежу", show_alert: true }, botToken);
      return true;
    }

    await saveCommentWait(chatId, {
      bankStatementItemId: payload.bankStatementItemId,
      purposeTitle: pending.purposeTitle,
      createdAt: new Date().toISOString(),
    });

    await answerCallbackQuery(callback.id, { text: "Надішліть коментар наступним повідомленням" }, botToken);
    await sendMessage(
      chatId,
      [
        `Надішліть коментар для статті: <b>${escapeHtml(pending.purposeTitle)}</b>`,
        "",
        "Наступне текстове повідомлення буде збережене як коментар до цього платежу.",
      ].join("\n"),
      { reply_markup: { force_reply: true, input_field_placeholder: "Коментар до платежу" } },
      botToken,
    );
    return true;
  }

  if (action === "comment_skip") {
    const createdAt = new Date();
    await clearCommentWait(chatId);
    await createExpenseAndNotifyTelegram({
      bankStatementItemId: payload.bankStatementItemId,
      chatId,
      comment: null,
      createdAt,
      createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
    });
    await answerCallbackQuery(callback.id, { text: "Збережено без коментаря" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      "Збережено без коментаря. Створення платежу в Altegio виконано або помилку відправлено окремим повідомленням.",
      {},
      botToken,
    );
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
      "Оберіть статтю витрат Altegio, окремо натисніть «Переміщення» для переказу між рахунками, або відкладіть розбір у таблицю зведення.",
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
    const statement = await prisma.bankStatementItem.findUnique({
      where: { id: payload.bankStatementItemId },
      select: {
        account: {
          select: {
            altegioAccountTitle: true,
            maskedPan: true,
            iban: true,
          },
        },
      },
    });
    const sourceAccountTitle = getBankAccountDisplayTitle(statement?.account);
    const purposeTitle = `Переміщення -> ${accountTitle}`;
    const automaticComment = `Переміщення коштів з рахунку "${sourceAccountTitle}" на рахунок "${accountTitle}"`;

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
        note: automaticComment,
      },
      update: {
        purposeId: null,
        purposeTitle,
        status: "awaiting_altegio_document",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
        note: automaticComment,
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

    await answerCallbackQuery(callback.id, { text: "Створюємо переміщення в Altegio" }, botToken);

    try {
      const createdAt = new Date();
      const result = await createAltegioTransferFromPendingPayment({
        bankStatementItemId: payload.bankStatementItemId,
        targetAccountId: accountId,
        targetAccountTitle: accountTitle,
        comment: automaticComment,
        createdAt,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      });

      await editMessageText(
        chatId,
        messageId,
        [
          `Збережено: <b>${escapeHtml(purposeTitle)}</b>`,
          "",
          result.reusedExisting ? "Переміщення вже існувало в Altegio і було прив'язане." : "Переміщення успішно створено в Altegio.",
          "",
          `<b>Вихідна транзакція:</b> #${escapeHtml(result.sourceTransaction.altegioId)}`,
          `<b>Вхідна транзакція:</b> #${escapeHtml(result.targetTransaction.altegioId)}`,
          `<b>Автоматичний коментар:</b> ${escapeHtml(automaticComment)}`,
        ].join("\n"),
        {},
        botToken,
      );
    } catch (error) {
      const message = await markAltegioCreationError(payload.bankStatementItemId, error);
      await editMessageText(
        chatId,
        messageId,
        [
          `Збережено: <b>${escapeHtml(purposeTitle)}</b>`,
          "",
          "Не вдалося автоматично створити переміщення в Altegio.",
          `<b>Помилка:</b> ${escapeHtml(message)}`,
          "",
          `<b>Автоматичний коментар:</b> ${escapeHtml(automaticComment)}`,
          "Платіж залишено у таблиці зведення для ручного розбору.",
        ].join("\n"),
        {},
        botToken,
      );
    }
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
      [
        `Збережено призначення: <b>${escapeHtml(purpose.title)}</b>`,
        "",
        "Бажаєте додати коментар до цього платежу?",
      ].join("\n"),
      { reply_markup: buildCommentOfferKeyboard(token) },
      botToken,
    );
    return true;
  }

  await answerCallbackQuery(callback.id, { text: "Невідома дія платежу", show_alert: true }, botToken);
  return true;
}

export async function handleBankPaymentTelegramMessage(message: {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
}): Promise<boolean> {
  const text = message.text?.trim();
  if (!text || text.startsWith("/")) return false;

  const wait = await loadCommentWait(message.chat.id);
  if (!wait) return false;

  const comment = text.slice(0, 500);
  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: wait.bankStatementItemId },
    data: {
      note: comment,
      createdBy: message.from?.username || message.from?.id?.toString() || "telegram",
    },
  });

  await (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId: wait.bankStatementItemId },
    data: {
      reviewNote: `Очікуємо документ Altegio для призначення: ${wait.purposeTitle}. Коментар: ${comment}`,
    },
  }).catch(async () => {
    await (prisma as any).bankAltegioPaymentMatch.create({
      data: {
        bankStatementItemId: wait.bankStatementItemId,
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо документ Altegio для призначення: ${wait.purposeTitle}. Коментар: ${comment}`,
      },
    });
  });

  await clearCommentWait(message.chat.id);
  await writeTelegramLog(TELEGRAM_CALLBACK_LOG, {
    action: "comment_text",
    bankStatementItemId: wait.bankStatementItemId,
    from: message.from,
    comment,
  });

  await createExpenseAndNotifyTelegram({
    bankStatementItemId: wait.bankStatementItemId,
    chatId: message.chat.id,
    comment,
    createdAt: new Date(),
    createdBy: message.from?.username || message.from?.id?.toString() || "telegram",
  });

  await sendMessage(
    message.chat.id,
    [
      "Коментар збережено і передано у створення платежу Altegio.",
      "",
      `<b>Стаття:</b> ${escapeHtml(wait.purposeTitle)}`,
      `<b>Коментар:</b> ${escapeHtml(comment)}`,
    ].join("\n"),
    {},
    getPaymentReconciliationBotToken(),
  );

  return true;
}
