// Документи руху складу. Прийомки ведемо в Kresco; продаж зі візиту — пізніше (каса).

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import { applyPostedWarehouseDocument } from "./stock";

export type CreateIntakeInput = {
  storageId: string;
  comment?: string;
  occurredAt?: string;
  createdBy?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    costPerUnit?: number;
  }>;
};

export async function createWarehouseIntake(input: CreateIntakeInput) {
  const storage = await prisma.warehouseStorage.findUnique({ where: { id: input.storageId } });
  if (!storage) {
    throw new Error("Склад не знайдено");
  }

  const lines = (input.lines || [])
    .map((line) => ({
      productId: String(line.productId || ""),
      quantity: Number(line.quantity) || 0,
      costPerUnit: Number(line.costPerUnit) || 0,
    }))
    .filter((line) => line.productId && line.quantity > 0);

  if (lines.length === 0) {
    throw new Error("Додайте хоча б один рядок з кількістю > 0");
  }

  const products = await prisma.warehouseProduct.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const line of lines) {
    if (!productById.has(line.productId)) {
      throw new Error("Товар у рядку прийомки не знайдено");
    }
    if (!(line.costPerUnit > 0)) {
      line.costPerUnit = productById.get(line.productId)?.costPerUnit || 0;
    }
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const document = await prisma.warehouseDocument.create({
    data: {
      type: "intake",
      status: "posted",
      occurredAt,
      kyivDay,
      toStorageId: input.storageId,
      comment: input.comment?.trim() || "Прийомка (Kresco)",
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          costPerUnit: line.costPerUnit,
        })),
      },
    },
    include: {
      lines: { include: { product: true } },
      toStorage: true,
    },
  });

  await applyPostedWarehouseDocument(document.id);
  console.log(
    `[warehouse/documents] Прийомка ${document.id}: рядків=${lines.length}, склад=${storage.title}, день=${kyivDay}`,
  );
  return document;
}
