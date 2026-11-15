"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function FilterIconButton({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-md border shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors ${
        active ? "bg-[#dbe7f5] text-blue-700 border-blue-300" : "bg-white text-gray-500 border-slate-200 hover:bg-slate-50"
      }`}
      title={title}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3h8M3 6h6M4.5 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function WarehouseFilterOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${
        selected ? "bg-blue-50 font-medium text-blue-800" : "text-gray-800 hover:bg-slate-50"
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center justify-center w-3 h-3 rounded border ${
          selected ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"
        }`}
      >
        {selected ? (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M10 3L4.5 8.5L2 6"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function WarehouseColumnFilter({
  columnLabel,
  active,
  children,
}: {
  columnLabel: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const width = 260;
      const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
      setPanelPosition({ top: rect.bottom + 4, left });
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

  const portalTarget =
    typeof document !== "undefined"
      ? document.getElementById("warehouse-filter-dropdown-root") ?? document.body
      : null;

  return (
    <div ref={dropdownRef} className="inline-flex">
      <FilterIconButton
        active={active || isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`Фільтр: ${columnLabel}`}
      />
      {isOpen && panelPosition && portalTarget
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[70] w-[260px] rounded-xl border border-slate-200/80 bg-white normal-case shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_28px_-10px_rgba(15,23,42,0.35)]"
              style={{ top: panelPosition.top, left: panelPosition.left }}
            >
              <div className="p-1.5">
                <div className="mb-1 px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{columnLabel}</div>
                {children(() => setIsOpen(false))}
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}
