// Створення складу лише в Kresco (без складу в Altegio).
// Такий склад облікує товари в Kresco (напр. «Волосся» для груп Хвости / Накладки / Стрічки / Треси),
// а прийомку, списання й продаж з нього пишемо в склад Altegio «Товари» (altegioWriteStorageId).

import { prisma } from "@/lib/prisma";

/** Склад Altegio «Товари» — куди пишемо операції зі складів, що існують лише в Kresco. */
export const ALTEGIO_GOODS_STORAGE_ID = 2343838;

/** Id складу Altegio для запису операцій: свій склад Altegio або склад-адресат для складу лише в Kresco. */
export function altegioStorageIdForWrites(storage: {
  altegioStorageId: number | null;
  altegioWriteStorageId?: number | null;
}): number | null {
  if (storage.altegioStorageId && storage.altegioStorageId > 0) return storage.altegioStorageId;
  if (storage.altegioWriteStorageId && storage.altegioWriteStorageId > 0) return storage.altegioWriteStorageId;
  return null;
}

/** Склад лише в Kresco: у нього немає власного складу Altegio. */
export function isKrescoOnlyStorage(storage: { altegioStorageId: number | null }): boolean {
  return !(storage.altegioStorageId && storage.altegioStorageId > 0);
}

export async function createWarehouseStorage(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Вкажіть назву складу");
  if (/^Склад #\d+$/.test(trimmed)) {
    throw new Error("Дайте складу зрозумілу назву, не «Склад #…»");
  }

  const existing = await prisma.warehouseStorage.findFirst({
    where: { title: { equals: trimmed, mode: "insensitive" }, isActive: true },
  });
  if (existing) throw new Error("Склад з такою назвою вже є");

  const row = await prisma.warehouseStorage.create({
    data: {
      title: trimmed,
      altegioStorageId: null,
      altegioWriteStorageId: ALTEGIO_GOODS_STORAGE_ID,
      // Як «Товари» в Altegio — у балансі фінзвіту.
      includeInFinanceReport: true,
      titleLocked: true,
      isActive: true,
    },
  });
  console.log(
    `[warehouse/storages] Створено склад «${trimmed}» лише в Kresco (операції → Altegio склад ${ALTEGIO_GOODS_STORAGE_ID})`,
  );
  return row;
}
