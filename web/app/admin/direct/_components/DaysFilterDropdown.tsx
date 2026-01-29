"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

type DaysOption = "none" | "growing" | "grown" | "overgrown";

const OPTIONS: { id: DaysOption; label: string; tooltip: string }[] = [
  { id: "none", label: "Немає", tooltip: "Коли стоїть прочерк (немає даних про дні)" },
  { id: "growing", label: "Відростає (0–60)", tooltip: "Від 0 до 60 днів з останнього візиту" },
  { id: "grown", label: "Відросло (60–90)", tooltip: "Від 60 до 90 днів" },
  { id: "overgrown", label: "Переросло (90+)", tooltip: "90 і більше днів" },
];

function bucket(c: DirectClient): DaysOption | null {
  const d = (c as any).daysSinceLastVisit;
  if (typeof d !== "number" || !Number.isFinite(d)) return "none";
  if (d >= 90) return "overgrown";
  if (d >= 60) return "grown";
  if (d >= 0) return "growing";
  return "none";
}

interface DaysFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function DaysFilterDropdown({
  clients,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: DaysFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<DaysOption | null>(filters.days);

  const counts = useMemo(() => {
    const m: Record<DaysOption, number> = { none: 0, growing: 0, grown: 0, overgrown: 0 };
    for (const c of clients) {
      const b = bucket(c);
      if (b) m[b]++;
    }
    return m;
  }, [clients]);

  useEffect(() => {
    setPending(filters.days);
  }, [filters.days]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPending(filters.days);
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, filters.days]);

  const hasActive = filters.days !== null;
  const hasPending = pending !== null;

  const handleApply = () => {
    onFiltersChange({ ...filters, days: pending });
    setIsOpen(false);
  };

  const handleClear = () => {
    setPending(null);
    onFiltersChange({ ...filters, days: null });
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
              {OPTIONS.map((opt) => {
                const isSelected = pending === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPending(isSelected ? null : opt.id)}
                    title={opt.tooltip}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${
                      isSelected ? "bg-blue-50 text-blue-700" : "text-gray-700"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded border ${
                          isSelected ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>{opt.label}</span>
                    </span>
                    <span className="text-gray-500 font-medium">({counts[opt.id]})</span>
                  </button>
                );
              })}
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
