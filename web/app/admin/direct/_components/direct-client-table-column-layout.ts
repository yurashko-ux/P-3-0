// Спільні стилі ширини/sticky для header і body таблиці Direct
import type { CSSProperties } from "react";

export type ColumnLayoutWidthMode = "fixed" | "min";

/** Порядок колонок: індекс збігається з effectiveWidths[i], colgroup і порядком th/td у рядках */
export const DIRECT_TABLE_COLUMN_KEYS = [
  "number",
  "act",
  "avatar",
  "name",
  "sales",
  "days",
  "communication",
  "inst",
  "calls",
  "callStatus",
  "state",
  "consultation",
  "record",
  "master",
  "phone",
  "actions",
] as const;
export type DirectTableColumnKey = (typeof DIRECT_TABLE_COLUMN_KEYS)[number];

export function getColumnStyle(
  config: { width: number; mode: ColumnLayoutWidthMode },
  useColgroup: boolean
): CSSProperties {
  if (useColgroup) return {};
  return config.mode === "fixed"
    ? { width: `${config.width}px`, minWidth: `${config.width}px`, maxWidth: `${config.width}px` }
    : { minWidth: `${config.width}px` };
}

export function getStickyColumnStyle(
  _config: { width: number; mode: ColumnLayoutWidthMode },
  left: number,
  isHeader: boolean = false
): CSSProperties {
  return {
    position: "sticky",
    left: `${left}px`,
    zIndex: isHeader ? 21 : 10,
    // thead sticky + горизонтальний скрол: фон обовʼязковий (раніше окремий table у fixed-хедері)
    ...(isHeader ? { backgroundColor: "var(--b2, #e8edf0)" } : { backgroundColor: "#ffffff" }),
  };
}
