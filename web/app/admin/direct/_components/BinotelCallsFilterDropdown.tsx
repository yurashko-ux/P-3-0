// web/app/admin/direct/_components/BinotelCallsFilterDropdown.tsx
// Фільтр дзвінків Binotel: Вхідні, Вихідні, Успішні, Не успішні (доповнюючі, не взаємовиключаючі)

"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

const OPTIONS = [
  { id: "incoming" as const, label: "Вхідні" },
  { id: "outgoing" as const, label: "Вихідні" },
  { id: "success" as const, label: "Успішні" },
  { id: "fail" as const, label: "Не успішні" },
  { id: "onlyNew" as const, label: "Нові", isOnlyNew: true },
];

const SUCCESS_DISPOSITIONS = ["ANSWER", "VM-SUCCESS", "SUCCESS"];

function normalizePhoneForCompare(phone: string | null | undefined): string {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("38") && digits.length >= 11) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length >= 9) return "38" + digits;
  return digits;
}

function clientMatchesBinotelFilter(
  client: DirectClient,
  direction: ("incoming" | "outgoing")[],
  outcome: ("success" | "fail")[],
  onlyNew: boolean,
  phoneToClientIds: Map<string, string[]>
): boolean {
  const count = (client as any).binotelCallsCount ?? 0;
  if (count <= 0) return false;

  if (onlyNew) {
    if (client.state !== "binotel-lead") return false;
    if (client.altegioClientId) return false;
    const phoneNorm = normalizePhoneForCompare(client.phone);
    if (!phoneNorm) return false;
    const idsWithSamePhone = phoneToClientIds.get(phoneNorm) ?? [];
    if (idsWithSamePhone.length !== 1 || idsWithSamePhone[0] !== client.id) return false;
  }

  const callType = (client as any).binotelLatestCallType as string | undefined;
  const disposition = (client as any).binotelLatestCallDisposition as string | undefined;
  const isSuccess = disposition ? SUCCESS_DISPOSITIONS.includes(disposition) : false;

  if (direction.length > 0 && direction.length < 2) {
    const wantIncoming = direction.includes("incoming");
    const wantOutgoing = direction.includes("outgoing");
    const matchDir =
      (wantIncoming && callType === "incoming") || (wantOutgoing && callType === "outgoing");
    if (!matchDir) return false;
  }

  if (outcome.length > 0 && outcome.length < 2) {
    const wantSuccess = outcome.includes("success");
    const wantFail = outcome.includes("fail");
    const matchOutcome = (wantSuccess && isSuccess) || (wantFail && !isSuccess);
    if (!matchOutcome) return false;
  }

  return true;
}

interface BinotelCallsFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  /** Кількість з усієї бази (пріоритет над обчисленням з clients) */
  binotelCallsFilterCounts?: { incoming: number; outgoing: number; success: number; fail: number; onlyNew?: number };
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function BinotelCallsFilterDropdown({
  clients,
  totalClientsCount,
  binotelCallsFilterCounts: binotelCallsFilterCountsFromApi,
  filters,
  onFiltersChange,
  columnLabel,
}: BinotelCallsFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const binotelCalls = filters.binotelCalls ?? {
    direction: [] as ("incoming" | "outgoing")[],
    outcome: [] as ("success" | "fail")[],
    onlyNew: false,
  };

  const [pendingDirection, setPendingDirection] = useState<("incoming" | "outgoing")[]>(
    binotelCalls.direction ?? []
  );
  const [pendingOutcome, setPendingOutcome] = useState<("success" | "fail")[]>(
    binotelCalls.outcome ?? []
  );
  const [pendingOnlyNew, setPendingOnlyNew] = useState<boolean>(binotelCalls.onlyNew ?? false);

  useEffect(() => {
    setPendingDirection(binotelCalls.direction ?? []);
    setPendingOutcome(binotelCalls.outcome ?? []);
    setPendingOnlyNew(binotelCalls.onlyNew ?? false);
  }, [binotelCalls.direction, binotelCalls.outcome, binotelCalls.onlyNew]);

  const hasValidApiCounts =
    binotelCallsFilterCountsFromApi &&
    typeof binotelCallsFilterCountsFromApi === "object" &&
    Object.values(binotelCallsFilterCountsFromApi).some((v) => (v ?? 0) > 0);

  const phoneToClientIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of clients) {
      const norm = normalizePhoneForCompare(c.phone);
      if (!norm) continue;
      const arr = m.get(norm) ?? [];
      if (!arr.includes(c.id)) arr.push(c.id);
      m.set(norm, arr);
    }
    return m;
  }, [clients]);

  const counts = useMemo(() => {
    if (hasValidApiCounts) {
      return {
        incoming: binotelCallsFilterCountsFromApi!.incoming ?? 0,
        outgoing: binotelCallsFilterCountsFromApi!.outgoing ?? 0,
        success: binotelCallsFilterCountsFromApi!.success ?? 0,
        fail: binotelCallsFilterCountsFromApi!.fail ?? 0,
        onlyNew: binotelCallsFilterCountsFromApi!.onlyNew ?? 0,
      };
    }
    const m: Record<string, number> = {};
    for (const opt of OPTIONS) {
      const dirFilter =
        opt.id === "incoming" ? ["incoming" as const] : opt.id === "outgoing" ? ["outgoing" as const] : [];
      const outFilter =
        opt.id === "success" ? ["success" as const] : opt.id === "fail" ? ["fail" as const] : [];
      const onlyNewFilter = (opt as { isOnlyNew?: boolean }).isOnlyNew ?? false;
      let n = 0;
      for (const c of clients) {
        if (clientMatchesBinotelFilter(c, dirFilter, outFilter, onlyNewFilter, phoneToClientIds)) n++;
      }
      m[opt.id] = n;
    }
    return m;
  }, [clients, hasValidApiCounts, binotelCallsFilterCountsFromApi, phoneToClientIds]);

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
      setPendingDirection(binotelCalls.direction ?? []);
      setPendingOutcome(binotelCalls.outcome ?? []);
      setPendingOnlyNew(binotelCalls.onlyNew ?? false);
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, binotelCalls.direction, binotelCalls.outcome, binotelCalls.onlyNew]);

  const hasActive =
    (binotelCalls.direction?.length ?? 0) > 0 ||
    (binotelCalls.outcome?.length ?? 0) > 0 ||
    (binotelCalls.onlyNew ?? false);
  const hasPending = pendingDirection.length > 0 || pendingOutcome.length > 0 || pendingOnlyNew;

  const toggleDirection = (id: "incoming" | "outgoing") => {
    setPendingDirection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleOutcome = (id: "success" | "fail") => {
    setPendingOutcome((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleOnlyNew = () => setPendingOnlyNew((prev) => !prev);

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      binotelCalls: { direction: pendingDirection, outcome: pendingOutcome, onlyNew: pendingOnlyNew },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setPendingDirection([]);
    setPendingOutcome([]);
    setPendingOnlyNew(false);
    onFiltersChange({
      ...filters,
      binotelCalls: { direction: [], outcome: [], onlyNew: false },
    });
    setIsOpen(false);
  };

  const portalTarget =
    typeof document !== "undefined"
      ? document.getElementById("direct-filter-dropdown-root") ?? document.body
      : null;

  const panelContent = (
    <div className="p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
        <span>Фільтри: {columnLabel}</span>
        {totalClientsCount != null && totalClientsCount > 0 && (
          <span className="text-gray-500 font-normal">({totalClientsCount})</span>
        )}
      </div>
      <div className="space-y-1">
        <div className="text-[10px] text-gray-500 px-2 mb-1">Напрямок (останній дзвінок)</div>
        {OPTIONS.slice(0, 2).map((opt) => {
          const isSelected = pendingDirection.includes(opt.id as "incoming" | "outgoing");
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleDirection(opt.id as "incoming" | "outgoing")}
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
                      <path
                        d="M10 3L4.5 8.5L2 6"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span>{opt.label}</span>
              </span>
              <span className="text-gray-500 font-medium">({counts[opt.id] ?? 0})</span>
            </button>
          );
        })}
        <div className="text-[10px] text-gray-500 px-2 mt-2 mb-1">Результат (останній дзвінок)</div>
        {OPTIONS.slice(2, 4).map((opt) => {
          const isSelected = pendingOutcome.includes(opt.id as "success" | "fail");
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleOutcome(opt.id as "success" | "fail")}
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
                      <path
                        d="M10 3L4.5 8.5L2 6"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span>{opt.label}</span>
              </span>
              <span className="text-gray-500 font-medium">({counts[opt.id] ?? 0})</span>
            </button>
          );
        })}
        <div className="text-[10px] text-gray-500 px-2 mt-2 mb-1">Binotel-ліди</div>
        {OPTIONS.filter((o) => (o as { isOnlyNew?: boolean }).isOnlyNew).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={toggleOnlyNew}
            className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${
              pendingOnlyNew ? "bg-blue-50 text-blue-700" : "text-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`inline-block w-3 h-3 rounded border ${
                  pendingOnlyNew ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"
                }`}
              >
                {pendingOnlyNew && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                    <path
                      d="M10 3L4.5 8.5L2 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span>{opt.label}</span>
            </span>
            <span className="text-gray-500 font-medium">({counts[opt.id] ?? 0})</span>
          </button>
        ))}
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
        onClick={() => setIsOpen(!isOpen)}
        title={`Фільтри для ${columnLabel}`}
      />
      {isOpen &&
        panelPosition &&
        portalTarget &&
        createPortal(
          <div
            ref={panelRef}
            className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[200px] max-h-[320px] overflow-y-auto pointer-events-auto"
            style={{
              position: "fixed",
              top: panelPosition.top,
              left: panelPosition.left,
              zIndex: 999999,
            }}
          >
            {panelContent}
          </div>,
          portalTarget
        )}
    </div>
  );
}
