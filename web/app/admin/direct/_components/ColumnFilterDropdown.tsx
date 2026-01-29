// web/app/admin/direct/_components/ColumnFilterDropdown.tsx
// Випадаюче меню фільтрів для колонок таблиці

"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";

export type ClientTypeFilter = "leads" | "clients" | "consulted" | "good" | "stars";

interface FilterOption {
  id: ClientTypeFilter;
  label: string;
  count: number;
  tooltip: string;
}

interface ColumnFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  selectedFilters: ClientTypeFilter[];
  onFiltersChange: (filters: ClientTypeFilter[]) => void;
  columnLabel: string;
}

export function ColumnFilterDropdown({
  clients,
  totalClientsCount,
  selectedFilters,
  onFiltersChange,
  columnLabel,
}: ColumnFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pendingFilters, setPendingFilters] = useState<ClientTypeFilter[]>(selectedFilters);

  // Підрахунок кількості для кожного фільтра (оптимізовано через useMemo)
  const filterCounts = useMemo(() => {
    let leads = 0;
    let clientsCount = 0;
    let consulted = 0;
    let good = 0;
    let stars = 0;

    for (const client of clients) {
      if (!client.altegioClientId) {
        leads++;
      } else {
        clientsCount++;
        // Консультовані: клієнти Altegio з spent = 0
        if ((client.spent ?? 0) === 0) {
          consulted++;
        }
      }
      
      const spent = client.spent ?? 0;
      if (spent >= 100000) {
        stars++;
      } else if (spent > 0) {
        good++;
      }
    }

    return { leads, clients: clientsCount, consulted, good, stars };
  }, [clients]);

  const filterOptions: FilterOption[] = useMemo(() => [
    { id: "leads", label: "Ліди", count: filterCounts.leads, tooltip: "Інстаграм ліди" },
    { id: "clients", label: "Клієнти", count: filterCounts.clients, tooltip: "Клієнти з Altegio ID" },
    { id: "consulted", label: "Консультовані", count: filterCounts.consulted, tooltip: "Клієнти Altegio з витратами = 0" },
    { id: "good", label: "Клієнти $", count: filterCounts.good, tooltip: "Клієнти з витратами від 1 до 99,999 грн" },
    { id: "stars", label: "Зірки $$$", count: filterCounts.stars, tooltip: "Клієнти з витратами від 100,000 грн" },
  ], [filterCounts]);

  // Синхронізуємо pendingFilters з selectedFilters при зміні selectedFilters
  useEffect(() => {
    setPendingFilters(selectedFilters);
  }, [selectedFilters]);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== "undefined") {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setPendingFilters(selectedFilters);
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, selectedFilters]);

  const toggleFilter = (filterId: ClientTypeFilter) => {
    // Оновлюємо тільки локальний стан, не застосовуємо фільтри
    setPendingFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((f) => f !== filterId)
        : [...prev, filterId]
    );
  };

  const handleApply = () => {
    // Застосовуємо pendingFilters до реальних фільтрів
    onFiltersChange(pendingFilters);
    setIsOpen(false);
  };

  const handleClear = () => {
    // Очищаємо і локальний стан, і реальні фільтри
    setPendingFilters([]);
    onFiltersChange([]);
    setIsOpen(false);
  };

  const hasActiveFilters = selectedFilters.length > 0;

  const portalTarget =
    typeof document !== "undefined" ? document.getElementById("direct-filter-dropdown-root") ?? document.body : null;

  const panelContent = (
    <div className="p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
        <span>Фільтри: {columnLabel}</span>
        {totalClientsCount !== undefined && totalClientsCount > 0 && (
          <span className="text-gray-500 font-normal">({totalClientsCount})</span>
        )}
      </div>
      <div className="space-y-1">
        {filterOptions.map((option) => {
          const isSelected = pendingFilters.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleFilter(option.id)}
              title={option.tooltip}
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
                <span>{option.label}</span>
              </span>
              <span className="text-gray-500 font-medium">({option.count})</span>
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
        {(hasActiveFilters || pendingFilters.length > 0) && (
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

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-center w-6 h-6 rounded border-2 hover:bg-base-300 transition-colors ${
          hasActiveFilters ? "bg-blue-100 text-blue-600 border-blue-500" : "text-gray-500 border-gray-500"
        }`}
        title={`Фільтри для ${columnLabel}`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3h8M3 6h6M4.5 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {isOpen && panelPosition && portalTarget && createPortal(
        <div
          ref={panelRef}
          className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px] pointer-events-auto"
          style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
        >
          {panelContent}
        </div>,
        portalTarget
      )}
    </div>
  );
}
