"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CSSProperties } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import type { ColumnLayoutWidthMode, DirectTableColumnKey } from "./direct-client-table-column-layout";

/** Ширини колонок body/header (дубль структури з DirectClientTable для уникнення циклічних імпортів). */
export type DirectTableColumnWidthConfig = {
  number: { width: number; mode: ColumnLayoutWidthMode };
  act: { width: number; mode: ColumnLayoutWidthMode };
  avatar: { width: number; mode: ColumnLayoutWidthMode };
  name: { width: number; mode: ColumnLayoutWidthMode };
  sales: { width: number; mode: ColumnLayoutWidthMode };
  days: { width: number; mode: ColumnLayoutWidthMode };
  communication: { width: number; mode: ColumnLayoutWidthMode };
  inst: { width: number; mode: ColumnLayoutWidthMode };
  calls: { width: number; mode: ColumnLayoutWidthMode };
  callStatus: { width: number; mode: ColumnLayoutWidthMode };
  callbackReminder: { width: number; mode: ColumnLayoutWidthMode };
  state: { width: number; mode: ColumnLayoutWidthMode };
  consultation: { width: number; mode: ColumnLayoutWidthMode };
  record: { width: number; mode: ColumnLayoutWidthMode };
  master: { width: number; mode: ColumnLayoutWidthMode };
  phone: { width: number; mode: ColumnLayoutWidthMode };
  actions: { width: number; mode: ColumnLayoutWidthMode };
};

export type ChatStatusUiVariant = "v1" | "v2";

export type DirectClientTableRowContextValue = {
  columnWidths: DirectTableColumnWidthConfig;
  getStickyLeft: (columnIndex: number) => number;
  getColumnStyle: (
    config: { width: number; mode: ColumnLayoutWidthMode },
    useColgroup: boolean
  ) => CSSProperties;
  getStickyColumnStyle: (
    config: { width: number; mode: ColumnLayoutWidthMode },
    left: number,
    isHeader?: boolean
  ) => CSSProperties;
  debugActivity: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  todayBlockRowIndices: { firstTodayIndex: number; firstCreatedTodayIndex: number };
  statuses: DirectStatus[];
  masters: { id: string; name: string }[];
  onClientUpdate: (clientId: string, updates: Partial<DirectClient>) => Promise<void>;
  onStatusMenuOpen?: (clientId: string) => void;
  hideFinances: boolean;
  hideActionsColumn: boolean;
  hideSalesColumn: boolean;
  canListenCalls: boolean;
  chatStatusUiVariant: ChatStatusUiVariant;
  instCallsCellMinHeight: string;
  setFullscreenAvatar: (v: { src: string; username: string } | null) => void;
  setMessagesHistoryClient: (c: DirectClient | null) => void;
  setBinotelHistoryClient: (c: DirectClient | null) => void;
  setInlineRecordingUrl: (url: string | null) => void;
  setStateHistoryClient: (c: DirectClient | null) => void;
  setRecordHistoryClient: (c: DirectClient | null) => void;
  setRecordHistoryType: (t: "paid" | "consultation") => void;
  setMasterHistoryClient: (c: DirectClient | null) => void;
  setEditingClient: (c: DirectClient | null) => void;
  /** Відкрити модалку «Передзвонити» для рядка */
  onOpenCallbackReminder: (client: DirectClient) => void;
  /** Сума ширин видимих колонок — для віртуальних рядків (absolute tr), де width:100% ламається через вузький tbody */
  bodyTableTotalWidthPx: number;
  /**
   * tbody display:block (віртуалізація): colgroup часто не задає ширини комірок — дублюємо width на кожному td.
   */
  enforceExplicitCellWidthsPx: boolean;
  getEffectiveColumnWidthPx: (key: DirectTableColumnKey) => number;
};

const DirectClientTableRowContext = createContext<DirectClientTableRowContextValue | null>(null);

export function DirectClientTableRowProvider({
  value,
  children,
}: {
  value: DirectClientTableRowContextValue;
  children: ReactNode;
}) {
  return (
    <DirectClientTableRowContext.Provider value={value}>{children}</DirectClientTableRowContext.Provider>
  );
}

export function useDirectClientTableRowContext(): DirectClientTableRowContextValue {
  const ctx = useContext(DirectClientTableRowContext);
  if (!ctx) {
    throw new Error("useDirectClientTableRowContext має використовуватись всередині DirectClientTableRowProvider");
  }
  return ctx;
}
