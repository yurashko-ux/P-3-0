"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectChatStatus } from "@/lib/direct-types";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import {
  INSTAGRAM_PRESENCE_FILTER_OPTIONS,
  type InstInstagramFilterValue,
  type InstInstagramPresenceCounts,
} from "@/lib/direct-instagram-presence-filter";
import { instInstagramCountsSum } from "@/lib/direct-instagram-filter-counts";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

interface InstFilterDropdownProps {
  clients: DirectClient[];
  chatStatuses: DirectChatStatus[];
  totalClientsCount?: number;
  /** Кількість по Inst-статусах з усієї бази (пріоритет над підрахунком з clients) */
  instCounts?: Record<string, number>;
  /** Кількість клієнтів з/без Instagram з усієї бази (клієнт vs лід) */
  instInstagramCounts?: InstInstagramPresenceCounts;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  /** Запит глобальних лічильників (SQL), якщо ще не завантажені */
  onRequestCounts?: () => void;
  columnLabel: string;
}

function countFromClientsPage(clients: DirectClient[]): InstInstagramPresenceCounts {
  let hasClient = 0;
  let missingClient = 0;
  let hasLead = 0;
  for (const c of clients) {
    const hasIg = hasNormalInstagramUsername(c.instagramUsername);
    const isClient = c.altegioClientId != null && Number(c.altegioClientId) > 0;
    if (isClient) {
      if (hasIg) hasClient++;
      else missingClient++;
    } else if (hasIg) {
      hasLead++;
    }
  }
  return { hasClient, missingClient, hasLead };
}

export function InstFilterDropdown({
  clients,
  chatStatuses,
  totalClientsCount,
  instCounts: instCountsFromApi,
  instInstagramCounts: instInstagramCountsFromApi,
  filters,
  onFiltersChange,
  onRequestCounts,
  columnLabel,
}: InstFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasValidInstCounts =
    instCountsFromApi != null &&
    typeof instCountsFromApi === 'object' &&
    Object.values(instCountsFromApi).some((n) => (n ?? 0) > 0);

  const usedIds = useMemo(() => {
    if (hasValidInstCounts) {
      return new Set(Object.keys(instCountsFromApi!).filter((id) => (instCountsFromApi![id] ?? 0) > 0));
    }
    const s = new Set<string>();
    for (const c of clients) {
      const id = (c as any).chatStatusId as string | undefined;
      if (id && id.trim()) s.add(id);
    }
    return s;
  }, [clients, instCountsFromApi, hasValidInstCounts]);

  const options = useMemo(() => {
    return chatStatuses
      .filter((st) => st.isActive && usedIds.has(st.id))
      .map((st) => ({
        id: st.id,
        label: st.name,
      }));
  }, [chatStatuses, usedIds]);

  const counts = useMemo(() => {
    if (hasValidInstCounts) {
      return new Map<string, number>(Object.entries(instCountsFromApi!));
    }
    const m = new Map<string, number>();
    for (const c of clients) {
      const id = (c as any).chatStatusId as string | undefined;
      if (id && usedIds.has(id)) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [clients, usedIds, instCountsFromApi, hasValidInstCounts]);

  const instagramPresenceCounts = useMemo(() => {
    if (instInstagramCountsFromApi != null) {
      const sum = instInstagramCountsSum(instInstagramCountsFromApi);
      const looksLikeEmptyStub =
        sum === 0 &&
        totalClientsCount != null &&
        totalClientsCount > 50;
      if (looksLikeEmptyStub) {
        return {
          hasClient: null,
          missingClient: null,
          hasLead: null,
          pending: true as const,
        };
      }
      return {
        ...instInstagramCountsFromApi,
        pending: false as const,
      };
    }
    const isPaginatedList =
      totalClientsCount != null && totalClientsCount > 0 && clients.length < totalClientsCount;
    if (isPaginatedList) {
      return {
        hasClient: null,
        missingClient: null,
        hasLead: null,
        pending: true as const,
      };
    }
    return { ...countFromClientsPage(clients), pending: false as const };
  }, [clients, instInstagramCountsFromApi, totalClientsCount]);

  const formatCount = (value: number | null, pending: boolean) => {
    if (value != null) return `(${value})`;
    if (pending) return '(…)';
    return '(0)';
  };

  const [pending, setPending] = useState<string[]>(filters.inst);
  const [pendingInstagram, setPendingInstagram] = useState<InstInstagramFilterValue[]>(
    filters.instInstagram ?? [],
  );

  useEffect(() => {
    setPending(filters.inst);
    setPendingInstagram(filters.instInstagram ?? []);
  }, [filters.inst, filters.instInstagram]);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== "undefined") {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const needsGlobalCounts =
      totalClientsCount != null &&
      totalClientsCount > 0 &&
      (instInstagramCountsFromApi == null ||
        instInstagramCountsSum(instInstagramCountsFromApi) === 0);
    if (needsGlobalCounts) onRequestCounts?.();
  }, [isOpen, instInstagramCountsFromApi, totalClientsCount, onRequestCounts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setPending(filters.inst);
      setPendingInstagram(filters.instInstagram ?? []);
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, filters.inst, filters.instInstagram]);

  const hasActive = filters.inst.length > 0 || (filters.instInstagram?.length ?? 0) > 0;
  const hasPending = pending.length > 0 || pendingInstagram.length > 0;

  const toggle = (id: string) => {
    setPending((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleInstagram = (id: InstInstagramFilterValue) => {
    setPendingInstagram((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleApply = () => {
    onFiltersChange({ ...filters, inst: pending, instInstagram: pendingInstagram });
    setIsOpen(false);
  };

  const handleClear = () => {
    setPending([]);
    setPendingInstagram([]);
    onFiltersChange({ ...filters, inst: [], instInstagram: [] });
    setIsOpen(false);
  };

  const portalTarget =
    typeof document !== "undefined" ? document.getElementById("direct-filter-dropdown-root") ?? document.body : null;

  const panelContent = (
    <div className="p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
        <span>Фільтри: {columnLabel}</span>
        {totalClientsCount != null && totalClientsCount > 0 && (
          <span className="text-gray-500 font-normal">({totalClientsCount})</span>
        )}
      </div>

      <div className="px-2 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        Instagram
      </div>
      <div className="space-y-1 mb-3">
        {INSTAGRAM_PRESENCE_FILTER_OPTIONS.map((opt) => {
          const isSelected = pendingInstagram.includes(opt.id);
          const countVal = instagramPresenceCounts[opt.id];
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleInstagram(opt.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between gap-2 hover:bg-base-200 transition-colors ${
                isSelected ? "bg-blue-50 text-blue-700" : "text-gray-700"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block w-3 h-3 shrink-0 rounded border ${
                    isSelected ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"
                  }`}
                >
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="leading-tight">{opt.label}</span>
              </span>
              <span className="text-gray-500 font-medium shrink-0">
                {formatCount(countVal, instagramPresenceCounts.pending)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-2 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        Статус чату
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
  );

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton
        active={hasActive}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`Фільтри для ${columnLabel}`}
      />
      {isOpen && panelPosition && portalTarget && createPortal(
        <div
          ref={panelRef}
          className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px] max-h-[360px] overflow-y-auto pointer-events-auto"
          style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
        >
          {panelContent}
        </div>,
        portalTarget
      )}
    </div>
  );
}
