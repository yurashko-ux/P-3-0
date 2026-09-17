export const WAREHOUSE_MOVEMENT_KINDS = ["intake", "write_off", "sale"] as const;
export type WarehouseMovementKind = (typeof WAREHOUSE_MOVEMENT_KINDS)[number];

export type WarehouseMovementLogRow = {
  id: string;
  kind: WarehouseMovementKind;
  kyivDay: string;
  occurredAt: string;
  code: string;
  costUah: number;
};
