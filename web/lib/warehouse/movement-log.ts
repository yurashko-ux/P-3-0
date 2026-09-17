// Лог руху складу: прийомки, списання, продажі. Знімки Altegio не включаємо.

import { prisma } from "@/lib/prisma";
import {
  WAREHOUSE_MOVEMENT_KINDS,
  type WarehouseMovementKind,
  type WarehouseMovementLogRow,
} from "./movement-log-types";

export type { WarehouseMovementKind, WarehouseMovementLogRow };
export { WAREHOUSE_MOVEMENT_KINDS };

function isMovementKind(value: string): value is WarehouseMovementKind {
  return value === "intake" || value === "write_off" || value === "sale";
}

export async function listWarehouseMovementLog(params: {
  year: number;
  month: number;
  limit?: number;
}): Promise<WarehouseMovementLogRow[]> {
  const prefix = `${params.year}-${String(params.month).padStart(2, "0")}`;
  const limit = Math.min(Math.max(params.limit ?? 80, 1), 200);

  const lines = await prisma.warehouseDocumentLine.findMany({
    where: {
      document: {
        status: "posted",
        type: { in: [...WAREHOUSE_MOVEMENT_KINDS] },
        kyivDay: { startsWith: prefix },
      },
    },
    select: {
      id: true,
      costPerUnit: true,
      product: { select: { title: true, sku: true } },
      document: { select: { type: true, occurredAt: true, kyivDay: true } },
    },
    orderBy: [{ document: { occurredAt: "desc" } }, { id: "desc" }],
    take: limit,
  });

  const rows: WarehouseMovementLogRow[] = [];
  for (const line of lines) {
    if (!isMovementKind(line.document.type)) continue;
    const code = String(line.product.title || "").trim() || (line.product.sku != null ? String(line.product.sku) : "—");
    rows.push({
      id: line.id,
      kind: line.document.type,
      kyivDay: line.document.kyivDay,
      occurredAt: line.document.occurredAt.toISOString(),
      code,
      costUah: Math.round((Number(line.costPerUnit) || 0) * 100) / 100,
    });
  }
  console.log(`[warehouse/movement] Лог за ${prefix}: ${rows.length} рядків`);
  return rows;
}
