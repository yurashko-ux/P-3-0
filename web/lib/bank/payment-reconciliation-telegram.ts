import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage, answerCallbackQuery, editMessageText, deleteMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  ignoreBankAltegioPayment,
  reconcileSingleOutgoingBankPayment,
} from "@/lib/bank/altegio-payment-reconcile";
import { refreshBankStatementHoldFromMonobank } from "@/lib/bank/payment-reconciliation-sync";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import {
  createAltegioExpenseFromPendingPayment,
  createAltegioTransferFromPendingPayment,
  isDocumentRequiredPurposeTitle,
  isTransferPurposeTitle,
  updateAltegioLinkedExpenseFromPendingPayment,
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
const COMMENT_WAIT_TTL_MS = 15 * 60 * 1000;
const PAYMENT_RECONCILIATION_TEST_USERNAME = "mykolay";
type TelegramTokenPayload = {
  bankStatementItemId: string;
  purposeIds: string[];
  accountIds?: string[];
  createdAt: string;
  mode?: "edit_linked";
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
  promptMessageId: number;
};

export type PaymentTelegramOutgoingMessageKind = "needs_review" | "auto_reconciled" | "match_proposal";

export type PaymentTelegramOutgoingMessageRef = {
  chatId: number;
  messageId: number;
  kind: PaymentTelegramOutgoingMessageKind;
};

const PAYMENT_CONFIRM_MATCH_PREFIX = "bank_payment_confirm:";
const PAYMENT_RECONCILED_ACK_PREFIX = "bank_payment_reconciled_ack:";

function parseTelegramOutgoingMessageRefs(value: unknown): PaymentTelegramOutgoingMessageRef[] {
  if (!Array.isArray(value)) return [];
  const refs: PaymentTelegramOutgoingMessageRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const chatId = Number((item as PaymentTelegramOutgoingMessageRef).chatId);
    const messageId = Number((item as PaymentTelegramOutgoingMessageRef).messageId);
    const kind = (item as PaymentTelegramOutgoingMessageRef).kind;
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) continue;
    if (kind !== "needs_review" && kind !== "auto_reconciled" && kind !== "match_proposal") continue;
    refs.push({ chatId, messageId, kind });
  }
  return refs;
}

function isIgnorableTelegramDeleteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("message to delete not found") ||
    message.includes("message can't be deleted") ||
    message.includes("message identifier is not specified") ||
    message.includes("bad request: message can't be deleted")
  );
}

/** Зберігає chatId/messageId для подальшого видалення з payment-бота. */
export async function appendTelegramOutgoingMessageRef(params: {
  bankStatementItemId: string;
  chatId: number;
  messageId: number;
  kind: PaymentTelegramOutgoingMessageKind;
}) {
  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    select: { telegramOutgoingMessages: true },
  });
  const existing = parseTelegramOutgoingMessageRefs(match?.telegramOutgoingMessages);
  const key = `${params.chatId}:${params.messageId}:${params.kind}`;
  const seen = new Set(existing.map((ref) => `${ref.chatId}:${ref.messageId}:${ref.kind}`));
  if (seen.has(key)) return;

  const next = [
    ...existing,
    { chatId: params.chatId, messageId: params.messageId, kind: params.kind },
  ];

  await (prisma as any).bankAltegioPaymentMatch.upsert({
    where: { bankStatementItemId: params.bankStatementItemId },
    create: {
      bankStatementItemId: params.bankStatementItemId,
      status: "needs_review",
      matchType: "telegram",
      telegramOutgoingMessages: next,
    },
    update: {
      telegramOutgoingMessages: next,
    },
  });
}

async function removeTelegramOutgoingMessageRefs(params: {
  bankStatementItemId: string;
  refsToRemove: Array<{ chatId: number; messageId: number }>;
}) {
  if (params.refsToRemove.length === 0) return;

  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    select: { telegramOutgoingMessages: true },
  });
  const existing = parseTelegramOutgoingMessageRefs(match?.telegramOutgoingMessages);
  const removeKeys = new Set(
    params.refsToRemove.map((ref) => `${ref.chatId}:${ref.messageId}`),
  );
  const next = existing.filter((ref) => !removeKeys.has(`${ref.chatId}:${ref.messageId}`));
  const hasNeedsReview = next.some((ref) => ref.kind === "needs_review" || ref.kind === "match_proposal");

  await (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId: params.bankStatementItemId },
    data: {
      telegramOutgoingMessages: next.length > 0 ? next : null,
      ...(hasNeedsReview ? {} : { telegramMessagesDeletedAt: new Date() }),
    },
  }).catch(() => null);
}

/** Збирає всі «потрібно звести» повідомлення: БД, pending і KV-лог. */
async function collectNeedsReviewTelegramMessageTargets(
  bankStatementItemId: string,
  options: {
    kinds?: PaymentTelegramOutgoingMessageKind[];
    exclude?: Array<{ chatId: number; messageId: number }>;
  } = {},
): Promise<PaymentTelegramOutgoingMessageRef[]> {
  const kinds = options.kinds ?? ["needs_review"];
  const kindSet = new Set(kinds);
  const excludeKeys = new Set(
    (options.exclude ?? []).map((ref) => `${ref.chatId}:${ref.messageId}`),
  );
  const byKey = new Map<string, PaymentTelegramOutgoingMessageRef>();

  const add = (
    chatId: number,
    messageId: number,
    kind: PaymentTelegramOutgoingMessageKind = "needs_review",
  ) => {
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId) || !kindSet.has(kind)) return;
    const key = `${chatId}:${messageId}`;
    if (excludeKeys.has(key)) return;
    if (!byKey.has(key)) byKey.set(key, { chatId, messageId, kind });
  };

  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { telegramOutgoingMessages: true },
  });
  for (const ref of parseTelegramOutgoingMessageRefs(match?.telegramOutgoingMessages)) {
    add(ref.chatId, ref.messageId, ref.kind);
  }

  const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId },
    select: { telegramChatId: true, telegramMessageId: true },
  });
  if (pending?.telegramChatId != null && pending?.telegramMessageId != null) {
    add(Number(pending.telegramChatId), Number(pending.telegramMessageId));
  }

  const rawEntries = await kvRead.lrange(TELEGRAM_OUTGOING_LOG, 0, 299);
  for (const raw of rawEntries) {
    const entry = parsePaymentTelegramLogEntry(raw);
    if (entry?.bankStatementItemId !== bankStatementItemId) continue;
    const ref = getPaymentTelegramMessageRef(entry);
    if (ref) add(ref.chatId, ref.messageId);
  }

  return Array.from(byKey.values());
}

async function deleteTelegramMessageSafe(
  chatId: number,
  messageId: number,
  botToken: string,
): Promise<"deleted" | "missing" | "failed"> {
  try {
    await deleteMessage(chatId, messageId, botToken);
    return "deleted";
  } catch (error) {
    if (isIgnorableTelegramDeleteError(error)) return "missing";
    console.warn("[payment-reconciliation-telegram] Не вдалося видалити Telegram-повідомлення:", {
      chatId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

/** Видаляє повідомлення payment-бота за збереженими refs (наприклад, після № зведення). */
export async function deleteReconciledPaymentTelegramMessages(
  bankStatementItemId: string,
  options: {
    kinds?: PaymentTelegramOutgoingMessageKind[];
    exclude?: Array<{ chatId: number; messageId: number }>;
    logAction?: string;
  } = {},
) {
  const refs = await collectNeedsReviewTelegramMessageTargets(bankStatementItemId, {
    kinds: options.kinds,
    exclude: options.exclude,
  });
  if (refs.length === 0) {
    console.log("[payment-reconciliation-telegram] Немає Telegram-повідомлень для видалення:", {
      bankStatementItemId,
      logAction: options.logAction ?? "deleted_after_reconcile",
    });
    await clearCommentWaitForPayment(bankStatementItemId);
    return { ok: true, deleted: 0, failed: 0 };
  }

  const botToken = getPaymentReconciliationBotToken();
  const logAction = options.logAction ?? "deleted_after_reconcile";
  let deleted = 0;
  let failed = 0;
  const removed: Array<{ chatId: number; messageId: number }> = [];

  for (const ref of refs) {
    const outcome = await deleteTelegramMessageSafe(ref.chatId, ref.messageId, botToken);
    if (outcome === "failed") {
      failed += 1;
      continue;
    }
    deleted += 1;
    removed.push({ chatId: ref.chatId, messageId: ref.messageId });
    await writeTelegramLog(TELEGRAM_OUTGOING_LOG, {
      bankStatementItemId,
      chatId: ref.chatId,
      messageId: ref.messageId,
      kind: ref.kind,
      action: logAction,
    });
  }

  await removeTelegramOutgoingMessageRefs({ bankStatementItemId, refsToRemove: removed });
  await clearCommentWaitForPayment(bankStatementItemId);

  if (deleted > 0 || failed > 0) {
    console.log("[payment-reconciliation-telegram] Видалення Telegram-повідомлень для платежу", {
      bankStatementItemId,
      logAction,
      targets: refs.length,
      deleted,
      failed,
    });
  }

  return { ok: failed === 0, deleted, failed };
}

/** Видаляє всі попередні «потрібно звести» повідомлення для платежу (перед повторною відправкою). */
async function deletePreviousNeedsReviewTelegramMessagesForPayment(
  bankStatementItemId: string,
): Promise<{ deleted: number; failed: number }> {
  const result = await deleteReconciledPaymentTelegramMessages(bankStatementItemId, {
    kinds: ["needs_review", "match_proposal"],
    logAction: "deleted_before_resend",
  });
  return { deleted: result.deleted, failed: result.failed };
}

type ProposedMatchPayload = {
  altegioFinanceTransactionId: string;
  altegioId: number;
  score?: number;
  operationDate?: string | Date;
  paymentPurpose?: string | null;
  categoryTitle?: string | null;
};

function parseProposedMatch(conflictData: unknown): ProposedMatchPayload | null {
  if (!conflictData || typeof conflictData !== "object") return null;
  const proposed = (conflictData as { proposedMatch?: ProposedMatchPayload }).proposedMatch;
  if (!proposed || typeof proposed.altegioFinanceTransactionId !== "string") return null;
  const altegioId = Number(proposed.altegioId);
  if (!Number.isFinite(altegioId)) return null;
  return { ...proposed, altegioId };
}

async function handlePaymentConfirmMatchCallback(callback: {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
  from?: { username?: string; id?: number };
}): Promise<boolean> {
  const data = callback.data || "";
  if (!data.startsWith(PAYMENT_CONFIRM_MATCH_PREFIX)) return false;

  const bankStatementItemId = data.slice(PAYMENT_CONFIRM_MATCH_PREFIX.length).trim();
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  const botToken = getPaymentReconciliationBotToken();

  if (!bankStatementItemId || !chatId || !messageId) {
    await answerCallbackQuery(callback.id, { text: "Дія застаріла", show_alert: true }, botToken);
    return true;
  }

  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { status: true, conflictData: true, altegioFinanceTransactionId: true },
  });

  if (match && ["auto_matched", "manual_matched"].includes(match.status) && match.altegioFinanceTransactionId) {
    await answerCallbackQuery(callback.id, { text: "Платіж уже зведено" }, botToken);
    await deleteTelegramMessageSafe(chatId, messageId, botToken);
    return true;
  }

  const proposed = parseProposedMatch(match?.conflictData);
  if (!proposed) {
    await answerCallbackQuery(callback.id, { text: "Пропозицію зведення не знайдено", show_alert: true }, botToken);
    return true;
  }

  try {
    const { manualMatchBankAltegioPayment } = await import("@/lib/bank/altegio-payment-reconcile");
    await manualMatchBankAltegioPayment({
      bankStatementItemId,
      altegioFinanceTransactionId: proposed.altegioFinanceTransactionId,
      matchedBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
    });

    await deleteReconciledPaymentTelegramMessages(bankStatementItemId, {
      kinds: ["needs_review", "match_proposal"],
      exclude: [{ chatId, messageId }],
      logAction: "deleted_after_reconcile",
    });
    await deleteTelegramMessageSafe(chatId, messageId, botToken);

    await sendMessage(
      chatId,
      `✅ Платіж зведено з документом Altegio #${proposed.altegioId}.`,
      {},
      botToken,
    );

    await writeTelegramLog(TELEGRAM_CALLBACK_LOG, {
      action: "confirm_match",
      bankStatementItemId,
      altegioFinanceTransactionId: proposed.altegioFinanceTransactionId,
      altegioId: proposed.altegioId,
      chatId,
      messageId,
    });

    await answerCallbackQuery(callback.id, { text: "Зведено" }, botToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[payment-reconciliation-telegram] Помилка підтвердження зведення:", {
      bankStatementItemId,
      error: message,
    });
    await answerCallbackQuery(callback.id, { text: message.slice(0, 180), show_alert: true }, botToken);
  }

  return true;
}

async function handlePaymentReconciledAckCallback(callback: {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
}): Promise<boolean> {
  const data = callback.data || "";
  if (!data.startsWith(PAYMENT_RECONCILED_ACK_PREFIX)) return false;

  const bankStatementItemId = data.slice(PAYMENT_RECONCILED_ACK_PREFIX.length).trim();
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  const botToken = getPaymentReconciliationBotToken();

  if (!bankStatementItemId || !chatId || !messageId) {
    await answerCallbackQuery(callback.id, { text: "Дія застаріла", show_alert: true }, botToken);
    return true;
  }

  try {
    await deleteMessage(chatId, messageId, botToken);
  } catch (error) {
    if (!isIgnorableTelegramDeleteError(error)) {
      console.warn("[payment-reconciliation-telegram] Помилка видалення після «Ознайомилась»:", {
        bankStatementItemId,
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await removeTelegramOutgoingMessageRefs({
    bankStatementItemId,
    refsToRemove: [{ chatId, messageId }],
  });

  await writeTelegramLog(TELEGRAM_CALLBACK_LOG, {
    action: "reconciled_ack",
    bankStatementItemId,
    chatId,
    messageId,
  });

  await answerCallbackQuery(callback.id, { text: "Дякуємо" }, botToken);
  return true;
}

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

/** Залишок monobank після операції — той самий, що в колонці «Залишки на рахунках». */
function formatTelegramBankBalanceAfterTransaction(balanceKopiykas: bigint | null): string {
  const formatted =
    balanceKopiykas == null
      ? "—"
      : `${new Intl.NumberFormat("uk-UA", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(balanceKopiykas) / 100)} ₴`;
  return `<b>Залишок на банківському рахунку після трансакції:</b> ${escapeHtml(formatted)}`;
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
    if (isDocumentRequiredPurposeTitle(canonicalTitle)) continue;
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

function buildCommentOfferKeyboardForEdit(token: string) {
  return {
    inline_keyboard: [
      [
        { text: "Змінити коментар", callback_data: `bank_payment:${token}:comment` },
        { text: "Залишити коментар", callback_data: `bank_payment:${token}:comment_keep` },
      ],
    ],
  };
}

function buildLinkedEditPurposeKeyboard(purposes: Array<{ title: string }>, token: string) {
  const purposeButtons = purposes.map((purpose, index: number) => ({
    text: purpose.title.slice(0, 48),
    callback_data: `bank_payment:${token}:p${index}`,
  }));

  return {
    inline_keyboard: [
      ...chunkKeyboardButtons(purposeButtons, 2),
      [{ text: "Скасувати", callback_data: `bank_payment:${token}:cancel_edit` }],
    ],
  };
}

function isEditLinkedToken(payload: TelegramTokenPayload): boolean {
  return payload.mode === "edit_linked";
}

async function getAltegioTransferTargetAccounts(bankStatementItemId: string): Promise<Array<{ id: string; title: string }>> {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    select: {
      account: {
        select: {
          altegioAccountId: true,
          altegioAccountTitle: true,
        },
      },
    },
  });
  const sourceAltegioAccountId = statement?.account.altegioAccountId
    ? String(statement.account.altegioAccountId)
    : null;

  try {
    const altegioAccounts = await fetchAltegioAccounts();
    const liveAccounts = altegioAccounts
      .filter((account) => {
        const id = account.id != null ? String(account.id) : "";
        return Boolean(id) && id !== sourceAltegioAccountId;
      })
      .map((account) => ({
        id: String(account.id),
        title: account.title || `Рахунок ${account.id}`,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "uk"));
    if (liveAccounts.length > 0) {
      console.log("[payment-reconciliation-telegram] Рахунки для переміщення", {
        bankStatementItemId,
        sourceAltegioAccountId,
        sourceTitle: statement?.account.altegioAccountTitle ?? null,
        targets: liveAccounts.map((account) => account.title),
      });
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
    const id = account.altegioAccountId ? String(account.altegioAccountId) : "";
    if (!id || seen.has(id) || id === sourceAltegioAccountId) continue;
    seen.add(id);
    result.push({
      id,
      title: account.altegioAccountTitle || `Рахунок ${id}`,
    });
  }

  return result;
}

async function presentTransferAccountPicker(params: {
  token: string;
  payload: TelegramTokenPayload;
  chatId: number;
  messageId: number;
  botToken: string;
  callbackId: string;
}): Promise<boolean> {
  // Не пропонуємо коментар — одразу список рахунків-призначень.
  await clearCommentWait(params.chatId);

  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: params.payload.bankStatementItemId },
    select: {
      account: {
        select: {
          altegioAccountId: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
        },
      },
    },
  });
  const sourceTitle = getBankAccountDisplayTitle(statement?.account);

  const accounts = await getAltegioTransferTargetAccounts(params.payload.bankStatementItemId);
  if (accounts.length === 0) {
    await answerCallbackQuery(
      params.callbackId,
      {
        text: "Немає інших рахунків Altegio для переміщення. Перевірте прив'язку рахунків у Банку.",
        show_alert: true,
      },
      params.botToken,
    );
    return true;
  }

  await saveToken(params.token, {
    ...params.payload,
    accountIds: accounts.map((account) => account.id),
  });

  const accountButtons = accounts.map((account, index) => ({
    text: account.title.slice(0, 48),
    callback_data: `bank_payment:${params.token}:a${index}`,
  }));

  await answerCallbackQuery(params.callbackId, { text: "Оберіть рахунок" }, params.botToken);
  await editMessageText(
    params.chatId,
    params.messageId,
    [
      "<b>Переміщення</b>",
      "",
      `<b>З рахунку:</b> ${escapeHtml(sourceTitle)}`,
      "",
      "Оберіть рахунок Altegio, <b>на який</b> переміщаємо кошти:",
    ].join("\n"),
    {
      reply_markup: {
        inline_keyboard: [
          ...chunkKeyboardButtons(accountButtons, 1),
          [{ text: "Назад до статей", callback_data: `bank_payment:${params.token}:back` }],
        ],
      },
    },
    params.botToken,
  );
  return true;
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

/**
 * Атомарно займає слот відправки, щоб паралельні webhook/кліки не дублювали повідомлення.
 * Повертає false, якщо інший процес уже надіслав або зараз надсилає (і force !== true).
 */
async function claimTelegramNotificationSlot(
  bankStatementItemId: string,
  options: {
    force?: boolean;
    requireStatus?: string | string[];
    initialStatus?: string;
    initialMatchType?: string;
  } = {},
): Promise<boolean> {
  if (options.force) {
    return true;
  }

  const now = new Date();
  const lockData = {
    telegramNotifiedAt: now,
    reviewNote: "Відправляється в Telegram...",
  };
  const statusFilter = options.requireStatus
    ? Array.isArray(options.requireStatus)
      ? options.requireStatus
      : [options.requireStatus]
    : null;

  const updated = await (prisma as any).bankAltegioPaymentMatch.updateMany({
    where: {
      bankStatementItemId,
      telegramNotifiedAt: null,
      ...(statusFilter ? { status: { in: statusFilter } } : {}),
    },
    data: lockData,
  });
  if (updated.count > 0) {
    return true;
  }

  const existing = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { telegramNotifiedAt: true },
  });
  if (existing?.telegramNotifiedAt) {
    return false;
  }
  if (existing) {
    return false;
  }

  try {
    await (prisma as any).bankAltegioPaymentMatch.create({
      data: {
        bankStatementItemId,
        status: options.initialStatus ?? "needs_review",
        matchType: options.initialMatchType ?? "telegram",
        ...lockData,
      },
    });
    return true;
  } catch {
    const retry = await (prisma as any).bankAltegioPaymentMatch.updateMany({
      where: {
        bankStatementItemId,
        telegramNotifiedAt: null,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      data: lockData,
    });
    return retry.count > 0;
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

/** Скидає очікування коментаря для всіх адмін-чатів, якщо воно стосується цього платежу. */
async function clearCommentWaitForPayment(bankStatementItemId: string) {
  const chatIds = await getPaymentReconciliationChatIds();
  for (const chatId of chatIds) {
    const wait = await loadCommentWait(chatId, { skipExpiryCheck: true });
    if (wait?.bankStatementItemId === bankStatementItemId) {
      await clearCommentWait(chatId);
    }
  }
}

async function loadCommentWait(
  chatId: number,
  options: { skipExpiryCheck?: boolean } = {},
): Promise<TelegramCommentWaitPayload | null> {
  const raw = await kvRead.getRaw(`${TELEGRAM_COMMENT_WAIT_PREFIX}${chatId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.bankStatementItemId !== "string" || typeof parsed.purposeTitle !== "string") {
      await clearCommentWait(chatId);
      return null;
    }
    const promptMessageId = Number(parsed.promptMessageId);
    if (!Number.isFinite(promptMessageId) || promptMessageId <= 0) {
      await clearCommentWait(chatId);
      return null;
    }
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
    if (!options.skipExpiryCheck && createdAt) {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs > COMMENT_WAIT_TTL_MS) {
        await clearCommentWait(chatId);
        return null;
      }
    }
    return {
      bankStatementItemId: parsed.bankStatementItemId,
      purposeTitle: parsed.purposeTitle,
      createdAt,
      promptMessageId,
    };
  } catch {
    await clearCommentWait(chatId);
    return null;
  }
}

/** Чи платіж ще очікує коментар / створення в Altegio (не зведено). */
async function isCommentWaitPaymentActionable(bankStatementItemId: string): Promise<boolean> {
  const [pending, match] = await Promise.all([
    (prisma as any).bankAltegioPendingPayment.findUnique({
      where: { bankStatementItemId },
      select: { purposeTitle: true, status: true },
    }),
    (prisma as any).bankAltegioPaymentMatch.findUnique({
      where: { bankStatementItemId },
      select: { status: true, altegioFinanceTransactionId: true },
    }),
  ]);

  if (!pending?.purposeTitle) return false;
  if (pending.status === "linked_edit") return true;
  if (pending.status === "linked") return false;
  if (
    match &&
    ["auto_matched", "manual_matched", "ignored"].includes(match.status) &&
    match.altegioFinanceTransactionId
  ) {
    return false;
  }
  return true;
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

/** Скидає всі застарілі очікування коментаря в адмін-чатах (аварійне очищення). */
export async function clearAllPaymentCommentWaits(): Promise<number> {
  const chatIds = await getPaymentReconciliationChatIds();
  let cleared = 0;
  for (const chatId of chatIds) {
    const wait = await loadCommentWait(chatId, { skipExpiryCheck: true });
    if (wait) {
      await clearCommentWait(chatId);
      cleared += 1;
    }
  }
  return cleared;
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
    const chatIds = [...new Set(TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS)];
    console.log("[payment-reconciliation-telegram] Відправляємо через payment-бота на TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS", {
      configured: TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS.length,
      unique: chatIds.length,
    });
    return chatIds;
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

/** Створює витрату в Altegio за збереженим Telegram-вибором статті (повторна спроба з адмінки). */
export async function finalizePendingPaymentFromTelegram(params: {
  bankStatementItemId: string;
  comment?: string | null;
  createdBy?: string | null;
}) {
  const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    select: { id: true, purposeTitle: true, status: true },
  });
  if (!pending?.purposeTitle) {
    throw new Error("Для цього платежу не обрано статтю витрат у Telegram");
  }

  const existingMatch = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId: params.bankStatementItemId },
    select: { status: true, altegioFinanceTransactionId: true },
  });
  if (
    existingMatch &&
    ["auto_matched", "manual_matched"].includes(existingMatch.status) &&
    existingMatch.altegioFinanceTransactionId
  ) {
    await deleteReconciledPaymentTelegramMessages(params.bankStatementItemId, {
      kinds: ["needs_review", "match_proposal"],
      logAction: "deleted_after_reconcile",
    });
    return { ok: true, skipped: true, reason: "already_linked" as const };
  }

  const result = await createAltegioExpenseFromPendingPayment({
    bankStatementItemId: params.bankStatementItemId,
    comment: params.comment ?? null,
    createdAt: new Date(),
    createdBy: params.createdBy ?? "admin",
  });

  await deleteReconciledPaymentTelegramMessages(params.bankStatementItemId, {
    kinds: ["needs_review"],
  });

  return { ok: true, skipped: false, result };
}

async function createExpenseAndNotifyTelegram(params: {
  bankStatementItemId: string;
  chatId: number;
  comment?: string | null;
  createdAt?: Date;
  createdBy?: string | null;
  interactionMessageId?: number;
}) {
  const botToken = getPaymentReconciliationBotToken();
  try {
    const result = await createAltegioExpenseFromPendingPayment({
      bankStatementItemId: params.bankStatementItemId,
      comment: params.comment,
      createdAt: params.createdAt,
      createdBy: params.createdBy,
    });
    await clearCommentWaitForPayment(params.bankStatementItemId);
    await deleteReconciledPaymentTelegramMessages(params.bankStatementItemId, {
      kinds: ["needs_review", "match_proposal"],
      logAction: "deleted_after_reconcile",
    });
    if (params.interactionMessageId != null) {
      await deleteTelegramMessageSafe(params.chatId, params.interactionMessageId, botToken);
    }
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

async function updateLinkedExpenseAndNotifyTelegram(params: {
  bankStatementItemId: string;
  chatId: number;
  comment?: string | null;
  preserveComment?: boolean;
  updatedBy?: string | null;
  interactionMessageId?: number;
}) {
  const botToken = getPaymentReconciliationBotToken();
  try {
    const result = await updateAltegioLinkedExpenseFromPendingPayment({
      bankStatementItemId: params.bankStatementItemId,
      comment: params.comment,
      preserveComment: params.preserveComment,
      updatedBy: params.updatedBy,
    });
    await clearCommentWaitForPayment(params.bankStatementItemId);
    await deleteReconciledPaymentTelegramMessages(params.bankStatementItemId, {
      kinds: ["needs_review", "match_proposal"],
      logAction: "deleted_after_linked_edit",
    });
    if (params.interactionMessageId != null) {
      await deleteTelegramMessageSafe(params.chatId, params.interactionMessageId, botToken);
    }
    await sendMessage(
      params.chatId,
      [
        "✅ Оновлено в Altegio. Зведення з банком збережено.",
        "",
        `<b>Altegio ID:</b> ${escapeHtml(result.transaction.altegioId)}`,
        `<b>Рахунок:</b> ${escapeHtml(result.transaction.accountTitle || result.transaction.accountId || "—")}`,
        `<b>Сума:</b> ${escapeHtml(formatKopiykas(result.transaction.amountKopiykas))}`,
        result.purposeChanged ? "<b>Статтю оновлено.</b>" : null,
        result.commentChanged ? "<b>Коментар оновлено.</b>" : "<b>Коментар без змін.</b>",
        result.transaction.comment ? `<b>Коментар:</b> ${escapeHtml(result.transaction.comment)}` : null,
      ].filter(Boolean).join("\n"),
      {},
      botToken,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[payment-reconciliation-telegram] Помилка оновлення зведеного платежу в Altegio:", {
      bankStatementItemId: params.bankStatementItemId,
      error: message,
    });
    await sendMessage(
      params.chatId,
      [
        "Не вдалося оновити платіж в Altegio.",
        "",
        `<b>Помилка:</b> ${escapeHtml(message)}`,
        "",
        "Зведення з банком не змінено.",
      ].join("\n"),
      {},
      botToken,
    );
    return null;
  }
}

export async function notifyBankPaymentMatchProposal(
  bankStatementItemId: string,
  options: { force?: boolean } = {},
) {
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

  const match = statement.altegioPaymentMatch;
  const proposed = parseProposedMatch(match?.conflictData);
  if (!match || !proposed) {
    return { ok: true, skipped: true, reason: "no_proposed_match" };
  }

  const altegio = await (prisma as any).altegioFinanceTransaction.findUnique({
    where: { id: proposed.altegioFinanceTransactionId },
  });
  if (!altegio) {
    return { ok: true, skipped: true, reason: "altegio_not_found" };
  }

  const accountLabel = getBankAccountDisplayTitle(statement.account);
  const altegioPurpose =
    altegio.paymentPurpose || altegio.categoryTitle || altegio.comment || "Без призначення";

  const message = [
    "<b>Пропонуємо звести банківський платіж</b>",
    "",
    "<b>Банк (monobank)</b>",
    `<b>Дата:</b> ${escapeHtml(statement.time.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
    `<b>Рахунок:</b> ${escapeHtml(accountLabel)}`,
    `<b>Сума:</b> ${escapeHtml(formatKopiykas(statement.amount))}`,
    statement.counterName ? `<b>Контрагент:</b> ${escapeHtml(statement.counterName)}` : null,
    statement.comment ? `<b>Призначення банку:</b> ${escapeHtml(statement.comment)}` : null,
    statement.description ? `<b>Опис:</b> ${escapeHtml(statement.description)}` : null,
    formatTelegramBankBalanceAfterTransaction(statement.balance),
    "",
    "<b>Altegio</b>",
    `<b>Операція:</b> #${escapeHtml(altegio.altegioId)}`,
    `<b>Дата:</b> ${escapeHtml(new Date(altegio.operationDate).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
    `<b>Рахунок:</b> ${escapeHtml(altegio.accountTitle || "—")}`,
    `<b>Сума:</b> ${escapeHtml(formatKopiykas(BigInt(altegio.amountKopiykas)))}`,
    `<b>Призначення:</b> ${escapeHtml(altegioPurpose)}`,
    altegio.documentId ? `<b>Документ:</b> ${escapeHtml(altegio.documentId)}` : null,
    "",
    "Натисніть <b>Звести</b>, щоб підтвердити зведення.",
  ].filter(Boolean).join("\n");

  const claimed = await claimTelegramNotificationSlot(bankStatementItemId, {
    force: options.force,
    requireStatus: ["needs_review", "conflict"],
    initialStatus: "needs_review",
    initialMatchType: "system",
  });
  if (!claimed) {
    return { ok: true, skipped: true, reason: "already_notified" };
  }

  const chatIds = await getPaymentReconciliationChatIds();
  if (chatIds.length === 0) {
    throw new Error("Не знайдено Telegram chatId для payment-бота");
  }

  const botToken = getPaymentReconciliationBotToken();
  const confirmKeyboard = {
    inline_keyboard: [
      [
        {
          text: "Звести",
          callback_data: `${PAYMENT_CONFIRM_MATCH_PREFIX}${bankStatementItemId}`,
        },
      ],
    ],
  };
  let sent = 0;
  for (const chatId of chatIds) {
    const telegramMessage = await sendMessage(
      chatId,
      message,
      { reply_markup: confirmKeyboard },
      botToken,
    );
    sent += 1;
    const outgoingMessageId = Number(telegramMessage?.message_id);
    if (Number.isFinite(outgoingMessageId)) {
      await appendTelegramOutgoingMessageRef({
        bankStatementItemId,
        chatId,
        messageId: outgoingMessageId,
        kind: "match_proposal",
      });
    }
    await writeTelegramLog(TELEGRAM_OUTGOING_LOG, {
      bankStatementItemId,
      chatId,
      kind: "match_proposal",
      telegramMessage,
    });
  }

  await (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId },
    data: {
      telegramNotifiedAt: new Date(),
      reviewNote: match.reviewNote || "Пропозицію зведення надіслано в Telegram",
    },
  });

  return { ok: true, sent };
}

/** @deprecated Автозведення вимкнено — лишено для сумісності зі старими викликами. */
export async function notifyBankPaymentReconciled(bankStatementItemId: string) {
  return notifyBankPaymentMatchProposal(bankStatementItemId);
}

async function ensureReconciledTelegramSent(_bankStatementItemId: string) {
  // Автозведення вимкнено — пропозиції надсилаються лише через notifyBankPaymentMatchProposal.
}

/** Webhook / sync: спочатку Altegio → пропозиція зведення або Telegram з вибором статті. */
export async function processOutgoingBankPaymentHoldFinalized(bankStatementItemId: string) {
  console.log("[payment-reconciliation-telegram] Hold фіналізовано, повторне зведення", {
    bankStatementItemId,
  });

  const holdRefresh = await refreshBankStatementHoldFromMonobank(bankStatementItemId);
  console.log("[payment-reconciliation-telegram] Hold refresh перед зведенням", {
    bankStatementItemId,
    ...holdRefresh,
  });

  const reconcileResult = await reconcileSingleOutgoingBankPayment(bankStatementItemId, {
    allowHold: false,
    sendTelegramOnMatch: true,
    setNeedsReviewOnMiss: false,
  });

  if (reconcileResult === "candidate_found") {
    return notifyBankPaymentMatchProposal(bankStatementItemId, { force: true });
  }

  if (reconcileResult === "matched") {
    return { ok: true, reconciled: true as const };
  }

  if (reconcileResult === "skipped_linked") {
    await ensureReconciledTelegramSent(bankStatementItemId);
    return { ok: true, skipped: true, reason: "already_linked" as const };
  }

  const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId },
    select: { purposeTitle: true, status: true },
  });
  if (pending?.purposeTitle && pending.status === "awaiting_altegio_document") {
    try {
      const finalized = await finalizePendingPaymentFromTelegram({ bankStatementItemId });
      if (!finalized.skipped) {
        return finalized;
      }
    } catch (error) {
      console.warn("[payment-reconciliation-telegram] Не вдалося автозвести після hold:", {
        bankStatementItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return notifyBankPaymentNeedsReview(bankStatementItemId, { skipAltegioCheck: true, force: true });
}

export async function processOutgoingBankPaymentsHoldFinalized(bankStatementItemIds: string[]) {
  const uniqueIds = [...new Set(bankStatementItemIds.filter(Boolean))];
  const results: Array<{ bankStatementItemId: string; ok: boolean; error?: string }> = [];

  for (const bankStatementItemId of uniqueIds) {
    try {
      await processOutgoingBankPaymentHoldFinalized(bankStatementItemId);
      results.push({ bankStatementItemId, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[payment-reconciliation-telegram] Помилка обробки фіналізації hold:", {
        bankStatementItemId,
        error: message,
      });
      results.push({ bankStatementItemId, ok: false, error: message });
    }
  }

  return results;
}

export async function processOutgoingBankPaymentNotification(params: {
  bankStatementItemId: string;
  hold: boolean;
  operationTime: Date;
  holdFinalized?: boolean;
}) {
  const { bankStatementItemId, holdFinalized } = params;

  if (holdFinalized) {
    return processOutgoingBankPaymentHoldFinalized(bankStatementItemId);
  }

  const reconcileResult = await reconcileSingleOutgoingBankPayment(bankStatementItemId, {
    allowHold: true,
    sendTelegramOnMatch: true,
    setNeedsReviewOnMiss: false,
  });

  if (reconcileResult === "candidate_found") {
    return { ok: true, proposed: true as const };
  }

  if (reconcileResult === "matched") {
    return { ok: true, reconciled: true as const };
  }

  if (reconcileResult === "skipped_linked") {
    await ensureReconciledTelegramSent(bankStatementItemId);
    return { ok: true, skipped: true, reason: "already_linked" as const };
  }

  if (reconcileResult === "awaiting_document") {
    return { ok: true, skipped: true, reason: "awaiting_altegio_document" as const };
  }

  if (reconcileResult === "skipped_invalid") {
    return { ok: true, skipped: true, reason: "skipped_invalid" as const };
  }

  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { telegramNotifiedAt: true },
  });
  if (match?.telegramNotifiedAt) {
    return { ok: true, skipped: true, reason: "already_notified" as const };
  }

  return notifyBankPaymentNeedsReview(bankStatementItemId, { skipAltegioCheck: true });
}

/** Повторна відправка в Telegram для вже зведеного платежу: зміна статті/коментаря без відв'язування. */
export async function notifyLinkedBankPaymentEdit(bankStatementItemId: string) {
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
  if (statement.amount >= 0n) {
    throw new Error("Редагування через Telegram доступне лише для вихідних платежів");
  }

  const match = statement.altegioPaymentMatch;
  if (
    !match?.altegioFinanceTransactionId ||
    !["auto_matched", "manual_matched"].includes(String(match.status || ""))
  ) {
    return { ok: true, skipped: true, reason: "not_linked" as const };
  }

  const altegio = await (prisma as any).altegioFinanceTransaction.findUnique({
    where: { id: match.altegioFinanceTransactionId },
  });
  if (!altegio) {
    throw new Error("Зв'язану операцію Altegio не знайдено");
  }

  const purposes = await getTelegramPaymentPurposes();
  const token = makeToken();
  await saveToken(token, {
    bankStatementItemId,
    purposeIds: purposes.map((purpose: any) => purpose.id),
    createdAt: new Date().toISOString(),
    mode: "edit_linked",
  });

  const accountLabel = getBankAccountDisplayTitle(statement.account);
  const altegioPurpose =
    altegio.paymentPurpose || altegio.categoryTitle || altegio.comment || "Без призначення";

  const message = [
    "<b>Зведений платіж — редагування в Altegio</b>",
    "Зведення з банком збережеться. Можна змінити статтю витрат і/або коментар.",
    "",
    "<b>Банк (monobank)</b>",
    `<b>Дата:</b> ${escapeHtml(statement.time.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
    `<b>Рахунок:</b> ${escapeHtml(accountLabel)}`,
    `<b>Сума:</b> ${escapeHtml(formatKopiykas(statement.amount))}`,
    statement.counterName ? `<b>Контрагент:</b> ${escapeHtml(statement.counterName)}` : null,
    "",
    "<b>Поточна операція Altegio</b>",
    `<b>ID:</b> #${escapeHtml(altegio.altegioId)}`,
    `<b>Стаття:</b> ${escapeHtml(altegioPurpose)}`,
    altegio.comment ? `<b>Коментар:</b> ${escapeHtml(altegio.comment)}` : "<b>Коментар:</b> —",
    "",
    "Оберіть нову статтю витрат Altegio або натисніть «Скасувати».",
  ].filter(Boolean).join("\n");

  const keyboard = buildLinkedEditPurposeKeyboard(purposes, token);
  await deletePreviousNeedsReviewTelegramMessagesForPayment(bankStatementItemId);

  const chatIds = await getPaymentReconciliationChatIds();
  if (chatIds.length === 0) {
    throw new Error("Не знайдено Telegram chatId для payment-бота");
  }

  const botToken = getPaymentReconciliationBotToken();
  let sent = 0;
  for (const chatId of chatIds) {
    const telegramMessage = await sendMessage(chatId, message, { reply_markup: keyboard }, botToken);
    sent += 1;
    const outgoingMessageId = Number(telegramMessage?.message_id);
    if (Number.isFinite(outgoingMessageId)) {
      await appendTelegramOutgoingMessageRef({
        bankStatementItemId,
        chatId,
        messageId: outgoingMessageId,
        kind: "needs_review",
      });
    }
    await writeTelegramLog(TELEGRAM_OUTGOING_LOG, {
      bankStatementItemId,
      chatId,
      token,
      mode: "edit_linked",
      telegramMessage,
    });
  }

  await (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId },
    data: {
      telegramNotifiedAt: new Date(),
      reviewNote: match.reviewNote || "Надіслано в Telegram для редагування зведеного платежу",
    },
  });

  return { ok: true, sent, token, editLinked: true as const };
}

export async function notifyBankPaymentNeedsReview(
  bankStatementItemId: string,
  options: { force?: boolean; skipAltegioCheck?: boolean; editLinked?: boolean } = {},
) {
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
  if (statement.amount >= 0n) {
    throw new Error("Telegram-повідомлення надсилаються лише для вихідних платежів");
  }

  const linkedMatch = statement.altegioPaymentMatch;
  const isLinkedReconciled =
    linkedMatch &&
    ["auto_matched", "manual_matched"].includes(String(linkedMatch.status || "")) &&
    linkedMatch.altegioFinanceTransactionId;

  if (isLinkedReconciled && options.editLinked) {
    return notifyLinkedBankPaymentEdit(bankStatementItemId);
  }

  // Ручний force (кнопка Telegram) — ЗАВЖДИ меню статей + «Переміщення» (не пропозицію «Звести»).
  // Авто-виклики без force лишають захист від дублікатів і автопропозиції збігу.
  if (!options.force) {
    if (
      linkedMatch &&
      ["auto_matched", "manual_matched", "ignored"].includes(linkedMatch.status)
    ) {
      await ensureReconciledTelegramSent(bankStatementItemId);
      return { ok: true, skipped: true, reason: "already_linked" };
    }

    if (linkedMatch?.telegramNotifiedAt) {
      return { ok: true, skipped: true, reason: "already_notified" };
    }

    if (!options.skipAltegioCheck) {
      const reconcileResult = await reconcileSingleOutgoingBankPayment(bankStatementItemId, {
        allowHold: true,
        sendTelegramOnMatch: true,
        setNeedsReviewOnMiss: false,
      });
      if (reconcileResult === "candidate_found") {
        return notifyBankPaymentMatchProposal(bankStatementItemId);
      }
      if (reconcileResult === "matched") {
        return { ok: true, reconciled: true };
      }
      if (reconcileResult === "skipped_linked") {
        await ensureReconciledTelegramSent(bankStatementItemId);
        return { ok: true, skipped: true, reason: "already_linked" };
      }
      if (reconcileResult === "awaiting_document") {
        return { ok: true, skipped: true, reason: reconcileResult };
      }
      // conflict / no_candidate — продовжуємо до Telegram (адмін обере статтю вручну)
    }
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
    statement.hold
      ? "<b>⚠️ Новий вихідний платіж (hold)</b>"
      : "<b>Потрібно звести вихідний банківський платіж</b>",
    statement.hold
      ? "Операція ще в hold у monobank — можна обрати статтю заздалегідь; повне зведення після фіналізації."
      : null,
    "",
    `<b>Дата:</b> ${escapeHtml(statement.time.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }))}`,
    `<b>Рахунок:</b> ${escapeHtml(accountLabel)}`,
    `<b>Сума:</b> ${escapeHtml(formatKopiykas(statement.amount))}`,
    statement.counterName ? `<b>Контрагент:</b> ${escapeHtml(statement.counterName)}` : null,
    statement.comment ? `<b>Призначення банку:</b> ${escapeHtml(statement.comment)}` : null,
    statement.description ? `<b>Опис:</b> ${escapeHtml(statement.description)}` : null,
    formatTelegramBankBalanceAfterTransaction(statement.balance),
    "",
    "Оберіть статтю витрат Altegio, окремо натисніть «Переміщення» для переказу між рахунками, або відкладіть розбір у таблицю зведення.",
  ].filter(Boolean).join("\n");

  const keyboard = {
    inline_keyboard: buildPaymentPurposeKeyboard(purposes, token).inline_keyboard,
  };

  const claimed = await claimTelegramNotificationSlot(bankStatementItemId, {
    force: options.force,
    requireStatus: ["needs_review", "conflict", "awaiting_altegio_document"],
    initialStatus: "needs_review",
    initialMatchType: "telegram",
  });
  if (!claimed) {
    return { ok: true, skipped: true, reason: "already_notified" };
  }

  await deletePreviousNeedsReviewTelegramMessagesForPayment(bankStatementItemId);

  const chatIds = await getPaymentReconciliationChatIds();
  if (chatIds.length === 0) {
    throw new Error("Не знайдено Telegram chatId для payment-бота. Додайте TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS або chatId для Mykolay.");
  }
  const botToken = getPaymentReconciliationBotToken();
  let sent = 0;
  const sentChatIds: number[] = [];
  const sendErrors: Array<{ chatId: number; error: string }> = [];

  for (const chatId of chatIds) {
    try {
      const telegramMessage = await sendMessage(chatId, message, { reply_markup: keyboard }, botToken);
      const outgoingMessageId = Number(telegramMessage?.message_id);
      if (!Number.isFinite(outgoingMessageId) || outgoingMessageId <= 0) {
        sendErrors.push({ chatId, error: "Telegram не повернув message_id" });
        continue;
      }
      sent += 1;
      sentChatIds.push(chatId);
      await appendTelegramOutgoingMessageRef({
        bankStatementItemId,
        chatId,
        messageId: outgoingMessageId,
        kind: "needs_review",
      });
      await writeTelegramLog(TELEGRAM_OUTGOING_LOG, {
        bankStatementItemId,
        chatId,
        messageId: outgoingMessageId,
        token,
        action: options.force ? "force_needs_review_sent" : "needs_review_sent",
        telegramMessage,
      });
      console.log("[payment-reconciliation-telegram] Надіслано needs_review", {
        bankStatementItemId,
        chatId,
        messageId: outgoingMessageId,
        force: Boolean(options.force),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendErrors.push({ chatId, error: errorMessage });
      console.error("[payment-reconciliation-telegram] Помилка sendMessage:", {
        bankStatementItemId,
        chatId,
        error: errorMessage,
      });
    }
  }

  if (sent === 0) {
    throw new Error(
      `Не вдалося надіслати в Telegram (чатів: ${chatIds.length}). `
      + sendErrors.map((item) => `${item.chatId}: ${item.error}`).join("; "),
    );
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
      // Повторна відправка з кнопки — знову «не зведено», щоб можна було обрати статтю / Переміщення.
      status: "needs_review",
      telegramNotifiedAt: new Date(),
      matchType: "telegram",
      reviewNote: options.force
        ? "Повторно відправлено адміністратору в Telegram"
        : "Відправлено адміністратору в Telegram",
      ...(options.force ? { conflictData: null } : {}),
    },
  });

  return {
    ok: true,
    sent,
    token,
    chatIds: sentChatIds,
    sendErrors: sendErrors.length > 0 ? sendErrors : undefined,
  };
}

export async function notifyUnmatchedBankPayments(limit = 10) {
  const seen = new Set<string>();
  const openStatuses = ["needs_review", "conflict"] as const;
  const matches = await (prisma as any).bankAltegioPaymentMatch.findMany({
    where: {
      status: { in: [...openStatuses] },
      telegramNotifiedAt: null,
      altegioFinanceTransactionId: null,
      bankStatementItem: {
        amount: { lt: 0 },
        account: { includeInOperationsTable: true },
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
  if (await handlePaymentConfirmMatchCallback(callback)) {
    return true;
  }
  if (await handlePaymentReconciledAckCallback(callback)) {
    return true;
  }
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
    mode: payload.mode ?? null,
    from: callback.from,
  });

  if (isEditLinkedToken(payload) && ["ignore", "later", "transfer"].includes(action)) {
    await answerCallbackQuery(
      callback.id,
      { text: "Платіж уже зведено — можна лише змінити статтю або коментар", show_alert: true },
      botToken,
    );
    return true;
  }

  // Переміщення — одразу список рахунків (без кроку з коментарем).
  if (action === "transfer") {
    return presentTransferAccountPicker({
      token,
      payload,
      chatId,
      messageId,
      botToken,
      callbackId: callback.id,
    });
  }

  if (action === "cancel_edit") {
    await clearCommentWait(chatId);
    await answerCallbackQuery(callback.id, { text: "Скасовано" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      "Редагування скасовано. Зведення в Altegio не змінено.",
      {},
      botToken,
    );
    return true;
  }

  if (action === "ignore") {
    await clearCommentWait(chatId);
    await ignoreBankAltegioPayment(payload.bankStatementItemId, "Ігноровано з Telegram");
    await answerCallbackQuery(callback.id, { text: "Платіж ігноровано" }, botToken);
    await editMessageText(chatId, messageId, "Платіж позначено як ігнорований у зведенні.", {}, botToken);
    return true;
  }

  if (action === "later") {
    await clearCommentWait(chatId);
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

    await answerCallbackQuery(callback.id, { text: "Надішліть коментар відповіддю на наступне повідомлення" }, botToken);
    const promptMessage = await sendMessage(
      chatId,
      [
        `Надішліть коментар для статті: <b>${escapeHtml(pending.purposeTitle)}</b>`,
        "",
        "Натисніть «Відповісти» на це повідомлення і введіть текст коментаря.",
        `Дійсне ${Math.round(COMMENT_WAIT_TTL_MS / 60000)} хв.`,
      ].join("\n"),
      { reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Коментар до платежу" } },
      botToken,
    );
    const promptMessageId = Number((promptMessage as { message_id?: number })?.message_id);
    if (!Number.isFinite(promptMessageId) || promptMessageId <= 0) {
      console.warn("[payment-reconciliation-telegram] Telegram не повернув message_id для prompt коментаря", {
        chatId,
        bankStatementItemId: payload.bankStatementItemId,
      });
      await sendMessage(
        chatId,
        "Не вдалося відкрити поле коментаря. Спробуйте «Без коментаря» або оберіть статтю ще раз.",
        {},
        botToken,
      );
      return true;
    }

    await saveCommentWait(chatId, {
      bankStatementItemId: payload.bankStatementItemId,
      purposeTitle: pending.purposeTitle,
      createdAt: new Date().toISOString(),
      promptMessageId,
    });
    return true;
  }

  if (action === "comment_skip") {
    const createdAt = new Date();
    await clearCommentWait(chatId);
    const existingMatch = await (prisma as any).bankAltegioPaymentMatch.findUnique({
      where: { bankStatementItemId: payload.bankStatementItemId },
      select: { status: true, altegioFinanceTransactionId: true },
    });
    if (
      !isEditLinkedToken(payload) &&
      existingMatch &&
      ["auto_matched", "manual_matched"].includes(existingMatch.status) &&
      existingMatch.altegioFinanceTransactionId
    ) {
      await answerCallbackQuery(callback.id, { text: "Платіж уже зведено" }, botToken);
      await editMessageText(chatId, messageId, "Платіж уже зведено в Altegio.", {}, botToken);
      return true;
    }

    if (isEditLinkedToken(payload)) {
      const result = await updateLinkedExpenseAndNotifyTelegram({
        bankStatementItemId: payload.bankStatementItemId,
        chatId,
        comment: null,
        preserveComment: true,
        updatedBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
        interactionMessageId: messageId,
      });
      await answerCallbackQuery(
        callback.id,
        { text: result ? "Статтю оновлено" : "Помилка оновлення — див. повідомлення нижче" },
        botToken,
      );
      return true;
    }

    const result = await createExpenseAndNotifyTelegram({
      bankStatementItemId: payload.bankStatementItemId,
      chatId,
      comment: null,
      createdAt,
      createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      interactionMessageId: messageId,
    });
    await answerCallbackQuery(
      callback.id,
      { text: result ? "Платіж зведено" : "Помилка створення — див. повідомлення нижче" },
      botToken,
    );
    return true;
  }

  if (action === "comment_keep") {
    if (!isEditLinkedToken(payload)) {
      await answerCallbackQuery(callback.id, { text: "Дія недоступна", show_alert: true }, botToken);
      return true;
    }

    await clearCommentWait(chatId);
    const result = await updateLinkedExpenseAndNotifyTelegram({
      bankStatementItemId: payload.bankStatementItemId,
      chatId,
      preserveComment: true,
      updatedBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      interactionMessageId: messageId,
    });
    await answerCallbackQuery(
      callback.id,
      { text: result ? "Статтю оновлено" : "Помилка оновлення — див. повідомлення нижче" },
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
      mode: payload.mode,
    });

    if (isEditLinkedToken(payload)) {
      await answerCallbackQuery(callback.id, { text: "Оберіть статтю витрат" }, botToken);
      await editMessageText(
        chatId,
        messageId,
        "Оберіть нову статтю витрат Altegio для зведеного платежу або натисніть «Скасувати».",
        { reply_markup: buildLinkedEditPurposeKeyboard(purposes, token) },
        botToken,
      );
      return true;
    }

    await answerCallbackQuery(callback.id, { text: "Оберіть статтю платежу" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      "Оберіть статтю витрат Altegio або натисніть «Переміщення».",
      { reply_markup: buildPaymentPurposeKeyboard(purposes, token) },
      botToken,
    );
    return true;
  }

  if (action?.startsWith("a")) {
    await clearCommentWait(chatId);
    const index = Number(action.slice(1));
    const accountId = payload.accountIds?.[index];
    if (!accountId) {
      await answerCallbackQuery(callback.id, { text: "Рахунок переміщення не знайдено", show_alert: true }, botToken);
      return true;
    }

    const accounts = await getAltegioTransferTargetAccounts(payload.bankStatementItemId);
    const account = accounts.find((item) => String(item.id) === String(accountId));
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
    const purposeTitle = "Переміщення";
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
      const result = await createAltegioTransferFromPendingPayment({
        bankStatementItemId: payload.bankStatementItemId,
        targetAccountId: accountId,
        targetAccountTitle: accountTitle,
        comment: automaticComment,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      });

      await deleteReconciledPaymentTelegramMessages(payload.bankStatementItemId, {
        kinds: ["needs_review"],
        logAction: "deleted_after_reconcile",
      });
      await deleteTelegramMessageSafe(chatId, messageId, botToken);

      await sendMessage(
        chatId,
        [
          `✅ Зведено: <b>${escapeHtml(purposeTitle)}</b>`,
          "",
          result.reusedExisting
            ? "Переміщення вже існувало в Altegio і було прив'язане."
            : "Створено 2 операції: вихід (−) з рахунку платежу і вхід (+) на обраний рахунок.",
          "",
          `<b>З рахунку (−):</b> ${escapeHtml(sourceAccountTitle)} → #${escapeHtml(result.sourceTransaction.altegioId)}`,
          `<b>На рахунок (+):</b> ${escapeHtml(accountTitle)} → #${escapeHtml(result.targetTransaction.altegioId)}`,
          `<b>Коментар:</b> ${escapeHtml(automaticComment)}`,
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
          `Збережено: <b>${escapeHtml(purposeTitle)}</b> → ${escapeHtml(accountTitle)}`,
          "",
          "Не вдалося автоматично створити переміщення в Altegio.",
          `<b>Помилка:</b> ${escapeHtml(message)}`,
          "",
          `<b>Коментар:</b> ${escapeHtml(automaticComment)}`,
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

    if (isTransferPurposeTitle(purpose.title)) {
      return presentTransferAccountPicker({
        token,
        payload,
        chatId,
        messageId,
        botToken,
        callbackId: callback.id,
      });
    }

    const existingMatch = await (prisma as any).bankAltegioPaymentMatch.findUnique({
      where: { bankStatementItemId: payload.bankStatementItemId },
      select: { status: true, altegioFinanceTransactionId: true },
    });
    const useLinkedEditFlow =
      isEditLinkedToken(payload) || Boolean(existingMatch?.altegioFinanceTransactionId);

    await (prisma as any).bankAltegioPendingPayment.upsert({
      where: { bankStatementItemId: payload.bankStatementItemId },
      create: {
        bankStatementItemId: payload.bankStatementItemId,
        purposeId: purpose.id,
        purposeTitle: purpose.title,
        status: useLinkedEditFlow ? "linked_edit" : "awaiting_altegio_document",
        createdFrom: "telegram",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      },
      update: {
        purposeId: purpose.id,
        purposeTitle: purpose.title,
        status: useLinkedEditFlow ? "linked_edit" : "awaiting_altegio_document",
        telegramChatId: BigInt(chatId),
        telegramMessageId: messageId,
        createdBy: callback.from?.username || callback.from?.id?.toString() || "telegram",
      },
    });

    if (!useLinkedEditFlow) {
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
    }

    await answerCallbackQuery(callback.id, { text: "Призначення збережено" }, botToken);
    await editMessageText(
      chatId,
      messageId,
      [
        `Обрано: <b>${escapeHtml(purpose.title)}</b>`,
        "",
        useLinkedEditFlow
          ? "Змінити коментар в Altegio або залишити поточний?"
          : "Додати коментар до платежу в Altegio або зберегти без коментаря?",
      ].join("\n"),
      {
        reply_markup: useLinkedEditFlow
          ? buildCommentOfferKeyboardForEdit(token)
          : buildCommentOfferKeyboard(token),
      },
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
  reply_to_message?: { message_id?: number; from?: { is_bot?: boolean; id?: number } };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
}): Promise<boolean> {
  const text = message.text?.trim();
  if (!text || text.startsWith("/")) return false;

  const wait = await loadCommentWait(message.chat.id);
  if (!wait) return false;

  const botToken = getPaymentReconciliationBotToken();
  const replyToId = message.reply_to_message?.message_id;
  const isReplyToPrompt = replyToId === wait.promptMessageId;
  if (!isReplyToPrompt) {
    console.log("[payment-reconciliation-telegram] Ігноруємо текст без reply на prompt коментаря", {
      chatId: message.chat.id,
      messageId: message.message_id,
      replyToId: replyToId ?? null,
      expectedPromptMessageId: wait.promptMessageId,
      bankStatementItemId: wait.bankStatementItemId,
    });
    await sendMessage(
      message.chat.id,
      [
        "Коментар не прийнято.",
        "",
        "Натисніть «Відповісти» на повідомлення бота з проханням ввести коментар, або оберіть «Без коментаря» у попередньому меню.",
      ].join("\n"),
      {},
      botToken,
    );
    return true;
  }

  if (!(await isCommentWaitPaymentActionable(wait.bankStatementItemId))) {
    await clearCommentWait(message.chat.id);
    await sendMessage(
      message.chat.id,
      "Цей платіж уже не очікує коментар у Telegram. Відкрийте таблицю зведення або надішліть нове повідомлення з кнопками.",
      {},
      getPaymentReconciliationBotToken(),
    );
    return true;
  }

  const comment = text.slice(0, 500);
  const pendingForEdit = await (prisma as any).bankAltegioPendingPayment.findUnique({
    where: { bankStatementItemId: wait.bankStatementItemId },
    select: { status: true },
  });
  const isLinkedEdit = pendingForEdit?.status === "linked_edit";

  await (prisma as any).bankAltegioPendingPayment.update({
    where: { bankStatementItemId: wait.bankStatementItemId },
    data: {
      note: comment,
      createdBy: message.from?.username || message.from?.id?.toString() || "telegram",
    },
  });

  if (!isLinkedEdit) {
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
  }

  await clearCommentWait(message.chat.id);
  await writeTelegramLog(TELEGRAM_CALLBACK_LOG, {
    action: isLinkedEdit ? "linked_edit_comment_text" : "comment_text",
    bankStatementItemId: wait.bankStatementItemId,
    from: message.from,
    comment,
  });

  if (isLinkedEdit) {
    await updateLinkedExpenseAndNotifyTelegram({
      bankStatementItemId: wait.bankStatementItemId,
      chatId: message.chat.id,
      comment,
      updatedBy: message.from?.username || message.from?.id?.toString() || "telegram",
    });
  } else {
    await createExpenseAndNotifyTelegram({
      bankStatementItemId: wait.bankStatementItemId,
      chatId: message.chat.id,
      comment,
      createdAt: new Date(),
      createdBy: message.from?.username || message.from?.id?.toString() || "telegram",
    });
  }

  return true;
}
