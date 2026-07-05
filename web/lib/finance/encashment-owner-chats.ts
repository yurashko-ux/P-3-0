// Власниця салону для підтвердження інкасації (AppUser + посада «Власник»).

import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { prisma } from "@/lib/prisma";

export type SalonOwnerRecipient = {
  userId: string;
  name: string;
  telegramUsername: string | null;
  chatId: number | null;
};

const OWNER_FUNCTION_NAME = "власник";

function normalizeTelegramUsername(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function toChatId(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getSalonOwnerRecipients(): Promise<SalonOwnerRecipient[]> {
  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  return users
    .filter((user) => {
      const fn = String(user.function?.name || "").trim().toLowerCase();
      return fn === OWNER_FUNCTION_NAME;
    })
    .map((user) => ({
      userId: user.id,
      name: user.name,
      telegramUsername: user.telegramUsername,
      chatId: toChatId(user.telegramChatId) ?? toChatId(user.telegramUserId),
    }));
}

export async function getEncashmentOwnerChatIds(): Promise<number[]> {
  if (TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS.length > 0) {
    return TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS;
  }

  const owners = await getSalonOwnerRecipients();
  const chatIds = owners
    .map((o) => o.chatId)
    .filter((id): id is number => id != null);

  return [...new Set(chatIds)];
}

export async function bindSalonOwnerTelegramChat(params: {
  chatId: number;
  telegramUserId?: number | null;
  telegramUsername?: string | null;
}): Promise<{ ok: boolean; ownerName?: string; error?: string }> {
  const username = normalizeTelegramUsername(params.telegramUsername);
  if (!username) {
    return { ok: false, error: "У Telegram-профілі немає username" };
  }

  const owners = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  const owner = owners.find((user) => {
    const fn = String(user.function?.name || "").trim().toLowerCase();
    if (fn !== OWNER_FUNCTION_NAME) return false;
    return normalizeTelegramUsername(user.telegramUsername) === username;
  });

  if (!owner) {
    return {
      ok: false,
      error: "Користувача з посадою «Власник» і таким Telegram username не знайдено в Доступах",
    };
  }

  await prisma.appUser.update({
    where: { id: owner.id },
    data: {
      telegramChatId: BigInt(params.chatId),
      telegramUserId:
        params.telegramUserId != null ? BigInt(params.telegramUserId) : owner.telegramUserId,
    },
  });

  return { ok: true, ownerName: owner.name };
}
