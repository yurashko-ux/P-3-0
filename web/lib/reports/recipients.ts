// Отримувачі щоденного звіту: активні AppUser з telegramChatId і доступом telegramDailyReport.

import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth-rbac";
import { mergeFunctionPermissions } from "@/lib/permissions-default";

export type DailyReportRecipient = {
  userId: string;
  name: string;
  telegramUsername: string | null;
  chatId: number;
};

export type DailyReportRecipientCandidate = {
  userId: string;
  name: string;
  functionName: string | null;
  telegramUsername: string | null;
  chatId: number | null;
  telegramDailyReport: string;
  eligible: boolean;
  reason: string;
};

function normalizeTelegramUsername(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function toChatId(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function canReceiveDailyOpsReportTelegram(functionPermissions: unknown): boolean {
  return hasPermission(mergeFunctionPermissions(functionPermissions), "telegramDailyReport");
}

function describeRecipientEligibility(params: {
  chatId: number | null;
  functionPermissions: unknown;
}): { eligible: boolean; reason: string; telegramDailyReport: string } {
  const merged = mergeFunctionPermissions(params.functionPermissions);
  const telegramDailyReport = merged.telegramDailyReport ?? "none";
  if (!params.chatId) {
    return {
      eligible: false,
      reason: "немає telegramChatId (надішліть /start боту)",
      telegramDailyReport,
    };
  }
  if (!canReceiveDailyOpsReportTelegram(params.functionPermissions)) {
    return {
      eligible: false,
      reason: "не увімкнено «Отримувати основний звіт в Telegram» у посади",
      telegramDailyReport,
    };
  }
  return { eligible: true, reason: "ok", telegramDailyReport };
}

export async function getDailyReportRecipientCandidates(): Promise<DailyReportRecipientCandidate[]> {
  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      telegramUsername: true,
      telegramChatId: true,
      function: {
        select: { name: true, permissions: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return users.map((user) => {
    const chatId = toChatId(user.telegramChatId);
    const eligibility = describeRecipientEligibility({
      chatId,
      functionPermissions: user.function?.permissions,
    });
    return {
      userId: user.id,
      name: user.name,
      functionName: user.function?.name ?? null,
      telegramUsername: user.telegramUsername,
      chatId,
      telegramDailyReport: eligibility.telegramDailyReport,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
    };
  });
}

export async function getDailyReportRecipients(): Promise<DailyReportRecipient[]> {
  const candidates = await getDailyReportRecipientCandidates();
  const fromDb: DailyReportRecipient[] = candidates
    .filter((candidate) => candidate.eligible && candidate.chatId != null)
    .map((candidate) => ({
      userId: candidate.userId,
      name: candidate.name,
      telegramUsername: candidate.telegramUsername,
      chatId: candidate.chatId as number,
    }));

  const envIds = TELEGRAM_ENV.REPORTS_RECIPIENT_CHAT_IDS;
  if (envIds.length === 0) {
    return fromDb;
  }

  const seen = new Set(fromDb.map((r) => r.chatId));
  const merged = [...fromDb];
  for (const chatId of envIds) {
    if (!seen.has(chatId)) {
      merged.push({
        userId: `env:${chatId}`,
        name: "Env recipient",
        telegramUsername: null,
        chatId,
      });
      seen.add(chatId);
    }
  }
  return merged;
}

export async function getDailyReportRecipientChatIds(): Promise<number[]> {
  const recipients = await getDailyReportRecipients();
  return [...new Set(recipients.map((r) => r.chatId))];
}

/**
 * Прив'язка будь-якого активного AppUser за Telegram username (підписка на щоденний звіт).
 */
export async function bindDailyReportTelegramChat(params: {
  chatId: number;
  telegramUserId?: number | null;
  telegramUsername?: string | null;
}): Promise<{
  ok: boolean;
  userName?: string;
  isEncashmentRole?: boolean;
  canReceiveReport?: boolean;
  error?: string;
}> {
  const username = normalizeTelegramUsername(params.telegramUsername);
  if (!username) {
    return { ok: false, error: "У Telegram-профілі немає username" };
  }

  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  const matched = users.find(
    (user) => normalizeTelegramUsername(user.telegramUsername) === username,
  );

  if (!matched) {
    return {
      ok: false,
      error:
        "Користувача з таким Telegram username не знайдено в розділі Доступи. Додайте username у профіль.",
    };
  }

  const fn = String(matched.function?.name || "").trim().toLowerCase();
  const isEncashmentRole = fn === "власник" || fn === "розробник";
  const canReceiveReport = canReceiveDailyOpsReportTelegram(matched.function?.permissions);

  await prisma.appUser.update({
    where: { id: matched.id },
    data: {
      telegramChatId: BigInt(params.chatId),
      telegramUserId:
        params.telegramUserId != null ? BigInt(params.telegramUserId) : matched.telegramUserId,
    },
  });

  return { ok: true, userName: matched.name, isEncashmentRole, canReceiveReport };
}

export async function findRecipientChatIdByTelegramUserId(
  telegramUserId: number,
): Promise<number | null> {
  const user = await prisma.appUser.findFirst({
    where: { isActive: true, telegramUserId: BigInt(telegramUserId) },
    select: { telegramChatId: true },
  });
  return toChatId(user?.telegramChatId);
}
