// Chat ID власниці салону для підтвердження інкасації.

import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { prisma } from "@/lib/prisma";

export async function getEncashmentOwnerChatIds(): Promise<number[]> {
  if (TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS.length > 0) {
    return TELEGRAM_ENV.ENCASHMENT_OWNER_CHAT_IDS;
  }

  const managers = await prisma.directMaster.findMany({
    where: {
      role: "direct-manager",
      isActive: true,
      telegramChatId: { not: null },
    },
    select: { telegramChatId: true },
  });

  const fromDb = managers
    .map((m) => {
      if (m.telegramChatId == null) return null;
      return typeof m.telegramChatId === "bigint" ? Number(m.telegramChatId) : Number(m.telegramChatId);
    })
    .filter((id): id is number => id != null && !Number.isNaN(id));

  if (fromDb.length > 0) return fromDb;

  return TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS;
}
