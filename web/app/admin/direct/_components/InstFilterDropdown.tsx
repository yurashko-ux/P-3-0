"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectChatStatus } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

interface InstFilterDropdownProps {
  clients: DirectClient[];
  chatStatuses: DirectChatStatus[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function InstFilterDropdown({
  clients,
  chatStatuses,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: InstFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients) {
      const id = (c as any).chatStatusId as string | undefined;
      if (id && id.trim()) s.add(id);
    }
    return s;
  }, [clients]);

  const options = useMemo(() => {
    return chatStatuses
      .filter((st) => st.isActive && usedIds.has(st.id))
      .map((st) => ({
        id: st.id,
        label: st.name,
      }));
  }, [chatStatuses, usedIds]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clients) {
      const id = (c as any).chatStatusId as string | undefined;
      if (id && usedIds.has(id)) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [clients, usedIds]);

  const [pending, setPending] = useState<string[]>(filters.inst);

  useEffect(() => {
    setPending(filters.inst);
  }, [filters.inst]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPending(filters.inst);
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, filters.inst]);

  const hasActive = filters.inst.length > 0;
  const hasPending = pending.length > 0;

  const toggle = (id: string) => {
    setPending((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleApply = () => {
    onFiltersChange({ ...filters, inst: pending });
    setIsOpen(false);
  };

  const handleClear = () => {
    setPending([]);
    onFiltersChange({ ...filters, inst: [] });
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
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[220px] max-h-[320px] overflow-y-auto">
          <div className="p-2">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
              <span>Фільтри: {columnLabel}</span>
              {totalClientsCount != null && totalClientsCount > 0 && (
                <span className="text-gray-500 font-normal">({totalClientsCount})</span>
              )}
            </div>
            <div className="space-y-1">
              {options.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-gray-500">Немає активних статусів у клієнтів</div>
              ) : (
                options.map((opt) => {
                  const isSelected = pending.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggle(opt.id)}
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
                      <span className="text-gray-500 font-medium">({counts.get(opt.id) ?? 0})</span>
                    </button>
                  );
                })
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
