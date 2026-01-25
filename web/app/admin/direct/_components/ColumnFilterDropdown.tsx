// web/app/admin/direct/_components/ColumnFilterDropdown.tsx
// Випадаюче меню фільтрів для колонок таблиці

"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { DirectClient } from "@/lib/direct-types";

export type ClientTypeFilter = "leads" | "clients" | "good" | "stars";

interface FilterOption {
  id: ClientTypeFilter;
  label: string;
  count: number;
}

interface ColumnFilterDropdownProps {
  clients: DirectClient[];
  selectedFilters: ClientTypeFilter[];
  onFiltersChange: (filters: ClientTypeFilter[]) => void;
  columnLabel: string;
}

export function ColumnFilterDropdown({
  clients,
  selectedFilters,
  onFiltersChange,
  columnLabel,
}: ColumnFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Підрахунок кількості для кожного фільтра (оптимізовано через useMemo)
  const filterCounts = useMemo(() => {
    let leads = 0;
    let clientsCount = 0;
    let good = 0;
    let stars = 0;

    for (const client of clients) {
      if (!client.altegioClientId) {
        leads++;
      } else {
        clientsCount++;
      }
      
      const spent = client.spent ?? 0;
      if (spent >= 100000) {
        stars++;
      } else if (spent > 0) {
        good++;
      }
    }

    return { leads, clients: clientsCount, good, stars };
  }, [clients]);

  const filterOptions: FilterOption[] = useMemo(() => [
    { id: "leads", label: "Ліди (Кл. інстаграм)", count: filterCounts.leads },
    { id: "clients", label: "Клієнти (Кл. Альтеджіо)", count: filterCounts.clients },
    { id: "good", label: "Хороші Кл. (До 100тис.)", count: filterCounts.good },
    { id: "stars", label: "Зірочки (клієнти >100тис.)", count: filterCounts.stars },
  ], [filterCounts]);

  // Закриваємо меню при кліку поза ним
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const toggleFilter = (filterId: ClientTypeFilter) => {
    const newFilters = selectedFilters.includes(filterId)
      ? selectedFilters.filter((f) => f !== filterId)
      : [...selectedFilters, filterId];
    onFiltersChange(newFilters);
  };

  const hasActiveFilters = selectedFilters.length > 0;

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-center w-5 h-5 rounded hover:bg-base-300 transition-colors ${
          hasActiveFilters ? "bg-blue-100 text-blue-600" : "text-gray-500"
        }`}
        title={`Фільтри для ${columnLabel}`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2 3h8M3 6h6M4.5 9h3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[220px]">
          <div className="p-2">
            <div className="text-xs font-semibold text-gray-700 mb-2 px-2">
              Фільтри: {columnLabel}
            </div>
            <div className="space-y-1">
              {filterOptions.map((option) => {
                const isSelected = selectedFilters.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleFilter(option.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${
                      isSelected ? "bg-blue-50 text-blue-700" : "text-gray-700"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded border ${
                          isSelected
                            ? "bg-blue-600 border-blue-600"
                            : "border-gray-400 bg-white"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="currentColor"
                            viewBox="0 0 12 12"
                          >
                            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>{option.label}</span>
                    </span>
                    <span className="text-gray-500 font-medium">({option.count})</span>
                  </button>
                );
              })}
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => onFiltersChange([])}
                className="w-full mt-2 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                Очистити фільтри
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
