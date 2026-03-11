// web/lib/binotel/find-or-create-lead.ts
// Знайти або створити лід з Binotel для номера без клієнта в Direct

import { prisma } from "@/lib/prisma";
import { saveDirectClient } from "@/lib/direct-store";
import { normalizePhone } from "./normalize-phone";
import type { DirectClient } from "@/lib/direct-types";

/**
 * Знаходить клієнта за телефоном (нормалізований) або створює Binotel-лід.
 * createdAt/firstContactDate = startTime дзвінка — для хронологічного розміщення в таблиці.
 */
export async function findOrCreateBinotelLead(
  externalNumber: string,
  startTime: Date
): Promise<string> {
  const extNorm = normalizePhone(externalNumber) || externalNumber;
  if (!extNorm) {
    throw new Error("externalNumber порожній або невалідний");
  }

  // Пошук існуючого клієнта за телефоном
  const allClients = await prisma.directClient.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  for (const c of allClients) {
    if (c.phone && normalizePhone(c.phone) === extNorm) {
      return c.id;
    }
  }

  // Перевірка по instagramUsername (binotel_xxx) — на випадок race condition
  const binotelUsername = `binotel_${extNorm}`;
  const existingByUsername = await prisma.directClient.findUnique({
    where: { instagramUsername: binotelUsername },
    select: { id: true },
  });
  if (existingByUsername) {
    return existingByUsername.id;
  }

  // Створюємо Binotel-лід. createdAt/firstContactDate = startTime — хронологічне розміщення
  const callTimeIso = startTime.toISOString();
  const client: DirectClient = {
    id: `direct_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    instagramUsername: binotelUsername,
    phone: extNorm,
    source: "other",
    statusId: "phone",
    state: "binotel-lead",
    firstContactDate: callTimeIso,
    createdAt: callTimeIso,
    updatedAt: callTimeIso,
    visitedSalon: false,
    signedUpForPaidService: false,
  };

  await saveDirectClient(client, "binotel-find-or-create-lead", undefined, {
    touchUpdatedAt: false,
  });

  return client.id;
}
