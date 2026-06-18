"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";
import { getAllowedFirstNames, groupByFirstTokenAndFilter } from "./masterFilterUtils";

interface ConsultMasterFilterDropdownProps {
  clients: DirectClient[];
  masters: { id: string; name: string }[];
  totalClientsCount?: number;
  /** Лічильники по всій базі з API — інакше fallback по поточній сторінці `clients`. */
  consultMasterFilterCounts?: Array<{ name: string; count: number }>;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function ConsultMasterFilterDropdown({
  clients,
  masters,
  totalClientsCount,
  consultMasterFilterCounts,
  filters,
  onFiltersChange,
  columnLabel,
}: ConsultMasterFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = filters.consultMaster.masterIds;

  const [masterIds, setMasterIds] = useState<string[]>(selected);

  const allowedFirstNames = useMemo(() => getAllowedFirstNames(masters), [masters]);
  const masterOptions = useMemo(() => {
    if (consultMasterFilterCounts != null) return consultMasterFilterCounts;
    return groupByFirstTokenAndFilter(
      clients.map((x) => (x.consultationMasterName || "").toString().trim()),
      allowedFirstNames
    );
  }, [clients, allowedFirstNames, consultMasterFilterCounts]);

  useEffect(() => {
    setMasterIds(selected);
  }, [selected]);

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

  const hasActive = selected.length > 0;

  const toggleMaster = (name: string) => {
    setMasterIds((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      consultMaster: { masterIds: [...masterIds] },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setMasterIds([]);
    onFiltersChange({
      ...filters,
      consultMaster: { masterIds: [] },
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

  const portalTarget =
    typeof document !== "undefined" ? document.getElementById("direct-filter-dropdown-root") ?? document.body : null;

  const panelContent = (
    <div className="p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
        <span>Фільтри: {columnLabel}</span>
        {totalClientsCount != null && totalClientsCount > 0 && <span className="text-gray-500 font-normal">({totalClientsCount})</span>}
      </div>
      {masterOptions.length > 0 && (
        <div className="mt-0">
          <div className="px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Майстри</div>
          <div className="space-y-0.5">
            {masterOptions.map(({ name, count }) => opt(`master-${name}`, name, masterIds.includes(name), () => toggleMaster(name), count))}
          </div>
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={handleApply} className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium">Застосувати</button>
        {hasActive && (
          <button type="button" onClick={handleClear} className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded transition-colors font-medium">Очистити</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton active={hasActive} onClick={() => setIsOpen(!isOpen)} title={`Фільтри для ${columnLabel}`} />
      {isOpen && panelPosition && portalTarget && createPortal(
        <div
          ref={panelRef}
          className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px] max-h-[420px] overflow-y-auto pointer-events-auto"
          style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
        >
          {panelContent}
        </div>,
        portalTarget
      )}
    </div>
  );
}
