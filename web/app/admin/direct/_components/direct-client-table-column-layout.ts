// Спільні стилі ширини/sticky для header і body таблиці Direct
import type { CSSProperties } from "react";

export type ColumnLayoutWidthMode = "fixed" | "min";

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
    ...(isHeader ? {} : { backgroundColor: "#ffffff" }),
  };
}
