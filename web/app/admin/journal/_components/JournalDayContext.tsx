"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type JournalViewMode = "day" | "week";

export type JournalSidebarActions = {
  onBook?: () => void;
  onSync?: () => void;
  syncing?: boolean;
};

type JournalDayContextValue = {
  day: string;
  setDay: (ymd: string) => void;
  viewMode: JournalViewMode;
  setViewMode: (mode: JournalViewMode) => void;
  sidebarActions: JournalSidebarActions;
  setSidebarActions: (actions: JournalSidebarActions) => void;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function kyivTodayYmd(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftYmd(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function formatJournalBoldDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(dt);
}

const JournalDayContext = createContext<JournalDayContextValue | null>(null);

export function JournalDayProvider({ children }: { children: ReactNode }) {
  const [day, setDay] = useState(kyivTodayYmd);
  const [viewMode, setViewMode] = useState<JournalViewMode>("day");
  const [sidebarActions, setSidebarActionsState] = useState<JournalSidebarActions>({});

  const setSidebarActions = useCallback((actions: JournalSidebarActions) => {
    setSidebarActionsState(actions);
  }, []);

  const value = useMemo(
    () => ({
      day,
      setDay,
      viewMode,
      setViewMode,
      sidebarActions,
      setSidebarActions,
    }),
    [day, viewMode, sidebarActions, setSidebarActions],
  );

  return <JournalDayContext.Provider value={value}>{children}</JournalDayContext.Provider>;
}

export function useJournalDay() {
  const ctx = useContext(JournalDayContext);
  if (!ctx) throw new Error("useJournalDay поза JournalDayProvider");
  return ctx;
}
