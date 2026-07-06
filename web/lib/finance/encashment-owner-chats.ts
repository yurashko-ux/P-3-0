// Власниця салону для підтвердження інкасації (AppUser + посада «Власник» / «Розробник» для тесту).

import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { prisma } from "@/lib/prisma";

export type SalonOwnerRecipient = {
  userId: string;
  name: string;
  telegramUsername: string | null;
  chatId: number | null;
};

const OWNER_FUNCTION_NAME = "власник";
const DEVELOPER_FUNCTION_NAME = "розробник";
const ENCASHMENT_RECIPIENT_FUNCTIONS = new Set([OWNER_FUNCTION_NAME, DEVELOPER_FUNCTION_NAME]);

function normalizeTelegramUsername(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function normalizeFunctionName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function toChatId(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapAppUserToRecipient(user: {
  id: string;
  name: string;
  telegramUsername: string | null;
  telegramChatId: bigint | null;
  telegramUserId: bigint | null;
}): SalonOwnerRecipient {
  return {
    userId: user.id,
    name: user.name,
    telegramUsername: user.telegramUsername,
    chatId: toChatId(user.telegramChatId) ?? toChatId(user.telegramUserId),
  };
}

export async function getSalonOwnerRecipients(): Promise<SalonOwnerRecipient[]> {
  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  return users
    .filter((user) => normalizeFunctionName(user.function?.name) === OWNER_FUNCTION_NAME)
    .map(mapAppUserToRecipient);
}

export async function getDeveloperRecipients(): Promise<SalonOwnerRecipient[]> {
  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  return users
    .filter((user) => normalizeFunctionName(user.function?.name) === DEVELOPER_FUNCTION_NAME)
    .map(mapAppUserToRecipient);
}

export async function getEncashmentOwnerChatIds(): Promise<number[]> {
  if (TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS.length > 0) {
    return TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS;
  }

  const owners = await getSalonOwnerRecipients();
  const ownerChatIds = owners
    .map((o) => o.chatId)
    .filter((id): id is number => id != null);

  if (ownerChatIds.length > 0) {
    return [...new Set(ownerChatIds)];
  }

  // Тестування: якщо власниця ще не прив'язала Telegram — надсилаємо розробнику з Доступів.
  const developers = await getDeveloperRecipients();
  const developerChatIds = developers
    .map((d) => d.chatId)
    .filter((id): id is number => id != null);

  if (developerChatIds.length > 0) {
    return [...new Set(developerChatIds)];
  }

  // Останній fallback: chat_id Mykolay з DirectMaster (як у payment-боті).
  const directMasterChatIds = await getEncashmentTestChatIdsFromDirectMaster();
  return [...new Set(directMasterChatIds)];
}

async function getEncashmentTestChatIdsFromDirectMaster(): Promise<number[]> {
  const masters = await prisma.directMaster.findMany({
    where: { isActive: true },
    select: {
      name: true,
      telegramUsername: true,
      telegramChatId: true,
    },
  });

  const testRecipient = masters.find((master) => {
    const username = normalizeTelegramUsername(master.telegramUsername);
    const name = String(master.name || "").trim().toLowerCase();
    return (
      username === "mykolay007" ||
      username === "mykolay" ||
      name.includes("mykolay") ||
      name.includes("миколай")
    );
  });

  const chatId = toChatId(testRecipient?.telegramChatId);
  return chatId ? [chatId] : [];
}

export async function bindSalonOwnerTelegramChat(params: {
  chatId: number;
  telegramUserId?: number | null;
  telegramUsername?: string | null;
}): Promise<{ ok: boolean; ownerName?: string; roleLabel?: string; error?: string }> {
  const username = normalizeTelegramUsername(params.telegramUsername);
  if (!username) {
    return { ok: false, error: "У Telegram-профілі немає username" };
  }

  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    include: { function: true },
  });

  const matched = users.find((user) => {
    const fn = normalizeFunctionName(user.function?.name);
    if (!ENCASHMENT_RECIPIENT_FUNCTIONS.has(fn)) return false;
    return normalizeTelegramUsername(user.telegramUsername) === username;
  });

  if (!matched) {
    const directByUsername = await prisma.directMaster
      .findMany({
        where: { isActive: true },
        select: { id: true, name: true, telegramUsername: true },
      })
      .then((masters) =>
        masters.find((m) => normalizeTelegramUsername(m.telegramUsername) === username),
      );

    if (directByUsername) {
      await prisma.directMaster.update({
        where: { id: directByUsername.id },
        data: { telegramChatId: BigInt(params.chatId) },
      });
      return { ok: true, ownerName: directByUsername.name, roleLabel: "DirectMaster" };
    }

    return {
      ok: false,
      error:
        "Користувача з посадою «Власник» або «Розробник» і таким Telegram username не знайдено в Доступах",
    };
  }

  const roleFn = normalizeFunctionName(matched.function?.name);
  const roleLabel = roleFn === DEVELOPER_FUNCTION_NAME ? "Розробник" : "Власник";

  await prisma.appUser.update({
    where: { id: matched.id },
    data: {
      telegramChatId: BigInt(params.chatId),
      telegramUserId:
        params.telegramUserId != null ? BigInt(params.telegramUserId) : matched.telegramUserId,
    },
  });

  return { ok: true, ownerName: matched.name, roleLabel };
}
