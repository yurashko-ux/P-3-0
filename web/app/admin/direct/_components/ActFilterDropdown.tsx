"use client";

import { useState, useRef, useEffect } from "react";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

const KYIV = "Europe/Kyiv";

function toKyivYearMonth(iso: string): string {
  try {
    const s = new Date(iso).toLocaleString("en-CA", {
      timeZone: KYIV,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return s.replace(/\//g, "-").slice(0, 7); // YYYY-MM
  } catch {
    return "";
  }
}

function currentKyivYearMonth(): string {
  return toKyivYearMonth(new Date().toISOString());
}

const YEARS = ["26", "27", "28"] as const;
const MONTHS = [
  { v: "1", l: "Січень" },
  { v: "2", l: "Лютий" },
  { v: "3", l: "Березень" },
  { v: "4", l: "Квітень" },
  { v: "5", l: "Травень" },
  { v: "6", l: "Червень" },
  { v: "7", l: "Липень" },
  { v: "8", l: "Серпень" },
  { v: "9", l: "Вересень" },
  { v: "10", l: "Жовтень" },
  { v: "11", l: "Листопад" },
  { v: "12", l: "Грудень" },
];

interface ActFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function ActFilterDropdown({
  clients,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: ActFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cur = currentKyivYearMonth();
  const currentMonthCount = clients.filter((c) => toKyivYearMonth(c.updatedAt) === cur).length;

  const [mode, setMode] = useState<"current_month" | "year_month" | null>(filters.act.mode);
  const [year, setYear] = useState(filters.act.year || "");
  const [month, setMonth] = useState(filters.act.month || "");

  useEffect(() => {
    setMode(filters.act.mode);
    setYear(filters.act.year || "");
    setMonth(filters.act.month || "");
  }, [filters.act.mode, filters.act.year, filters.act.month]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMode(filters.act.mode);
        setYear(filters.act.year || "");
        setMonth(filters.act.month || "");
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, filters.act.mode, filters.act.year, filters.act.month]);

  const hasActive = filters.act.mode !== null;
  const pendingCurrent = mode === "current_month";
  const pendingYearMonth = mode === "year_month" && year && month;
  const hasPending = (mode === "current_month") || pendingYearMonth;
  const changed =
    mode !== filters.act.mode ||
    (filters.act.mode === "year_month" && (year !== (filters.act.year || "") || month !== (filters.act.month || "")));

  const handleApply = () => {
    if (mode === "current_month") {
      onFiltersChange({ ...filters, act: { mode: "current_month" } });
    } else if (mode === "year_month" && year && month) {
      onFiltersChange({ ...filters, act: { mode: "year_month", year, month } });
    } else {
      onFiltersChange({ ...filters, act: { mode: null } });
    }
    setIsOpen(false);
  };

  const handleClear = () => {
    setMode(null);
    setYear("");
    setMonth("");
    onFiltersChange({ ...filters, act: { mode: null } });
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton
        active={hasActive}
        onClick={() => setIsOpen(!isOpen)}
        title={`Фільтри для ${columnLabel}`}
      />
      {isOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[220px]">
          <div className="p-2">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
              <span>Фільтри: {columnLabel}</span>
              {totalClientsCount != null && totalClientsCount > 0 && (
                <span className="text-gray-500 font-normal">({totalClientsCount})</span>
              )}
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setMode(mode === "current_month" ? null : "current_month")}
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${
                  mode === "current_month" ? "bg-blue-50 text-blue-700" : "text-gray-700"
                }`}
                title="Дата останньої активності в поточному місяці"
              >
                <span>Поточний місяць</span>
                <span className="text-gray-500 font-medium">({currentMonthCount})</span>
              </button>
              <div className="px-2 py-1 text-xs text-gray-500">Рік + Місяць</div>
              <div className="flex gap-1 px-2">
                <select
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setMode("year_month");
                  }}
                  className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs"
                >
                  <option value="">Рік</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <select
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setMode("year_month");
                  }}
                  className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs"
                >
                  <option value="">Міс.</option>
                  {MONTHS.map((m) => (
                    <option key={m.v} value={m.v}>{m.l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium"
              >
                Застосувати
              </button>
              {(hasActive || hasPending) && (
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
        </div>
      )}
    </div>
  );
}
