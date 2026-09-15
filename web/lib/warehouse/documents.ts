// Документи руху складу. Нові прийомки — documents-kresco (dual-write в Altegio).

import { createGoodsIntake } from "./documents-kresco";

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
  const invoiceAmount = (input.lines || []).reduce(
    (acc, line) => acc + (Number(line.quantity) || 0) * (Number(line.costPerUnit) || 0),
    0,
  );
  return createGoodsIntake({
    storageId: input.storageId,
    title: input.comment?.trim() || "Прийомка товару",
    currencyCode: "UAH",
    invoiceAmount: invoiceAmount > 0 ? invoiceAmount : 0.01,
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: (input.lines || []).map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      price: Number(line.costPerUnit) || 0,
    })),
  });
}
