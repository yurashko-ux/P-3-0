"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

interface MasterFilterDropdownProps {
  clients: DirectClient[];
  masters: { id: string; name: string }[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function MasterFilterDropdown({
  clients,
  masters,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: MasterFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const m = filters.master;

  const [hands, setHands] = useState<2 | 4 | 6 | null>(m.hands);
  const [primaryIds, setPrimaryIds] = useState<string[]>(m.primaryMasterIds);
  const [secondaryIds, setSecondaryIds] = useState<string[]>(m.secondaryMasterIds);

  const primaryNames = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clients) {
      const n = (c.serviceMasterName || "").toString().trim();
      if (n) map.set(n, (map.get(n) ?? 0) + 1);
      const mid = c.masterId;
      if (mid) {
        const mn = masters.find((x) => x.id === mid)?.name?.trim();
        if (mn) map.set(mn, (map.get(mn) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, masters]);

  const secondaryNames = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clients) {
      const n = ((c as any).serviceSecondaryMasterName || "").toString().trim();
      if (!n) continue;
      map.set(n, (map.get(n) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const handsCounts = useMemo(() => {
    const h: Record<"2" | "4" | "6", number> = { "2": 0, "4": 0, "6": 0 };
    for (const c of clients) {
      const v = (c as any).paidServiceHands;
      if (v === 2 || v === 4 || v === 6) h[String(v) as "2" | "4" | "6"]++;
    }
    return h;
  }, [clients]);

  useEffect(() => {
    setHands(m.hands);
    setPrimaryIds(m.primaryMasterIds);
    setSecondaryIds(m.secondaryMasterIds);
  }, [m.hands, m.primaryMasterIds, m.secondaryMasterIds]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const hasActive = m.hands !== null || m.primaryMasterIds.length > 0 || m.secondaryMasterIds.length > 0;

  const togglePrimary = (name: string) => {
    setPrimaryIds((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };
  const toggleSecondary = (name: string) => {
    setSecondaryIds((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      master: { hands, primaryMasterIds: [...primaryIds], secondaryMasterIds: [...secondaryIds] },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setHands(null);
    setPrimaryIds([]);
    setSecondaryIds([]);
    onFiltersChange({
      ...filters,
      master: { hands: null, primaryMasterIds: [], secondaryMasterIds: [] },
    });
    setIsOpen(false);
  };

  const opt = (key: string, label: string, sel: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${sel ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
    >
      <span className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded border ${sel ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"}`}>
          {sel && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        <span>{label}</span>
      </span>
      {count != null && <span className="text-gray-500 font-medium">({count})</span>}
    </button>
  );

  const section = (title: string, children: React.ReactNode) => (
    <div className="mt-2 first:mt-0" key={title}>
      <div className="px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton active={hasActive} onClick={() => setIsOpen(!isOpen)} title={`Фільтри для ${columnLabel}`} />
      {isOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[240px] max-h-[420px] overflow-y-auto">
          <div className="p-2">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
              <span>Фільтри: {columnLabel}</span>
              {totalClientsCount != null && totalClientsCount > 0 && <span className="text-gray-500 font-normal">({totalClientsCount})</span>}
            </div>
            {section("Руки", (
              <>
                {opt("hands-2", "2 руки", hands === 2, () => setHands(hands === 2 ? null : 2), handsCounts["2"])}
                {opt("hands-4", "4 руки", hands === 4, () => setHands(hands === 4 ? null : 4), handsCounts["4"])}
                {opt("hands-6", "6 рук", hands === 6, () => setHands(hands === 6 ? null : 6), handsCounts["6"])}
              </>
            ))}
            {primaryNames.length > 0 && section("Головний майстер", primaryNames.map(({ name, count }) => opt(`primary-${name}`, name, primaryIds.includes(name), () => togglePrimary(name), count)))}
            {secondaryNames.length > 0 && section("Додатковий майстер", secondaryNames.map(({ name, count }) => opt(`secondary-${name}`, name, secondaryIds.includes(name), () => toggleSecondary(name), count)))}
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={handleApply} className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium">Застосувати</button>
              {hasActive && (
                <button type="button" onClick={handleClear} className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded transition-colors font-medium">Очистити</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
