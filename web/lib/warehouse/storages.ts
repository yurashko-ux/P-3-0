// Створення складу в Kresco + Altegio.

import { prisma } from "@/lib/prisma";
import { createAltegioStorage } from "@/lib/altegio/warehouse-write";

export async function createWarehouseStorage(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Вкажіть назву складу");
  if (/^Склад #\d+$/.test(trimmed)) {
    throw new Error("Дайте складу зрозумілу назву, не «Склад #…»");
  }

  const existing = await prisma.warehouseStorage.findFirst({
    where: { title: trimmed, isActive: true },
  });
  if (existing) throw new Error("Склад з такою назвою вже є");

  const altegio = await createAltegioStorage(trimmed);
  const already = await prisma.warehouseStorage.findUnique({
    where: { altegioStorageId: altegio.id },
  });
  if (already) {
    const row = await prisma.warehouseStorage.update({
      where: { id: already.id },
      data: { title: trimmed, titleLocked: true, isActive: true },
    });
    console.log(`[warehouse/storages] Увімкнено існуючий склад Altegio id=${altegio.id}`);
    return row;
  }

  const row = await prisma.warehouseStorage.create({
    data: {
      title: trimmed,
      altegioStorageId: altegio.id,
      includeInFinanceReport: trimmed.toLocaleLowerCase("uk-UA") === "товари",
      titleLocked: true,
      isActive: true,
    },
  });
  console.log(`[warehouse/storages] Створено склад «${trimmed}» altegioStorageId=${altegio.id}`);
  return row;
}
