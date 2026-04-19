// web/app/admin/direct/_components/CallbackReminderFilterDropdown.tsx
// Фільтр колонки «Передзвонити»: дедлайн у майбутньому / сьогодні / у минулому (лише рядки з встановленою датою callbackReminderKyivDay).

"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

const KYIV_TZ = "Europe/Kyiv";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidCallbackDay(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
}

interface CallbackReminderFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function CallbackReminderFilterDropdown({
  clients,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: CallbackReminderFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const preset = filters.callbackReminder?.appointedPreset ?? null;
  const [pendingPreset, setPendingPreset] = useState<"past" | "today" | "future" | null>(preset);

  useEffect(() => {
    setPendingPreset(filters.callbackReminder?.appointedPreset ?? null);
  }, [filters.callbackReminder?.appointedPreset]);

  const todayYmd = useMemo(() => kyivTodayYmd(), []);

  const countsFromClients = useMemo(() => {
    let future = 0;
    let today = 0;
    let past = 0;
    for (const c of clients) {
      const d = (c.callbackReminderKyivDay ?? "").toString().trim();
      if (!isValidCallbackDay(d)) continue;
      if (d > todayYmd) future += 1;
      else if (d === todayYmd) today += 1;
      else past += 1;
    }
    return { future, today, past };
  }, [clients, todayYmd]);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== "undefined") {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const hasActive = preset != null;

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      callbackReminder: { appointedPreset: pendingPreset },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setPendingPreset(null);
    onFiltersChange({
      ...filters,
      callbackReminder: { appointedPreset: null },
    });
    setIsOpen(false);
  };

  const opt = (
    key: string,
    label: string,
    sel: boolean,
    onClick: () => void,
    count?: number
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${sel ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`inline-block w-3 h-3 rounded-full border ${sel ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"}`}
        />
        <span>{label}</span>
      </span>
      {count != null && <span className="text-gray-500 font-medium">({count})</span>}
    </button>
  );

  const panelContent = (
    <div className="p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
        <span>Фільтри: {columnLabel}</span>
        {totalClientsCount != null && totalClientsCount > 0 && (
          <span className="text-gray-500 font-normal">({totalClientsCount})</span>
        )}
      </div>
      <div className="px-2 py-1 text-[10px] text-gray-500 leading-snug mb-1">
        Лише клієнти з встановленою датою нагадування (Europe/Kyiv).
      </div>
      <div className="space-y-0.5">
        {opt(
          "cb-future",
          "Очікуємо",
          pendingPreset === "future",
          () => setPendingPreset(pendingPreset === "future" ? null : "future"),
          countsFromClients.future
        )}
        {opt(
          "cb-today",
          "Дедлайн",
          pendingPreset === "today",
          () => setPendingPreset(pendingPreset === "today" ? null : "today"),
          countsFromClients.today
        )}
        {opt(
          "cb-past",
          "Прострочений дедлайн",
          pendingPreset === "past",
          () => setPendingPreset(pendingPreset === "past" ? null : "past"),
          countsFromClients.past
        )}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={handleApply}
          className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium"
        >
          Застосувати
        </button>
        {hasActive && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded transition-colors font-medium"
          >
            Очистити
          </button>
        )}
      </div>
    </div>
  );

  const portalTarget =
    typeof document !== "undefined" ? document.getElementById("direct-filter-dropdown-root") ?? document.body : null;

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton active={hasActive} onClick={() => setIsOpen(!isOpen)} title={`Фільтри для ${columnLabel}`} />
      {isOpen &&
        panelPosition &&
        portalTarget &&
        createPortal(
          <div
            ref={panelRef}
            className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[240px] max-h-[420px] overflow-y-auto pointer-events-auto"
            style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
          >
            {panelContent}
          </div>,
          portalTarget
        )}
    </div>
  );
}
