"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  InstInstagramCounts,
  InstInstagramFilterValue,
} from "@/lib/inactive-base/instagram-presence-filter";
import { FilterIconButton } from "../../_components/FilterIconButton";

const PANEL_CLASS =
  "bg-white border border-gray-300 rounded-lg shadow-lg min-w-[260px] max-h-[320px] overflow-y-auto pointer-events-auto";

const OPTIONS: Array<{ id: InstInstagramFilterValue; label: string }> = [
  { id: "has", label: "Є Instagram" },
  { id: "missing", label: "Немає Instagram" },
];

type Props = {
  value: InstInstagramFilterValue[];
  onChange: (next: InstInstagramFilterValue[]) => void;
  counts?: InstInstagramCounts | null;
};

export function InactiveBaseInstagramFilterDropdown({ value, onChange, counts }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<InstInstagramFilterValue[]>(value);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPanelPosition({ top: rect.bottom + 4, left: Math.max(8, rect.left - 160) });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen]);

  const hasActive = value.length > 0;

  const countById = useMemo(
    () =>
      ({
        has: counts?.has ?? null,
        missing: counts?.missing ?? null,
      }) as Record<InstInstagramFilterValue, number | null>,
    [counts]
  );

  const apply = () => {
    onChange(pending);
    setIsOpen(false);
  };

  const reset = () => {
    setPending([]);
    onChange([]);
    setIsOpen(false);
  };

  const toggle = (id: InstInstagramFilterValue) => {
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div ref={anchorRef} className="inline-flex">
      <FilterIconButton
        active={hasActive}
        onClick={() => setIsOpen((o) => !o)}
        title="Фільтр Inst: клієнти з реальним Instagram (можна слати через ManyChat)"
      />
      {isOpen &&
        panelPosition &&
        createPortal(
          <div
            ref={panelRef}
            className={PANEL_CLASS}
            style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
          >
            <div className="p-3 text-sm text-gray-900">
              <div className="font-semibold mb-2">Inst — системні повідомлення</div>
              <p className="text-[11px] text-gray-500 mb-2">
                Критерій: реальний Instagram (не missing_instagram_*, no_instagram_*, altegio_*).
              </p>
              <div className="space-y-1">
                {OPTIONS.map((opt) => {
                  const selected = pending.includes(opt.id);
                  const n = countById[opt.id];
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-gray-100 text-left ${
                        selected ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-gray-700"
                      }`}
                      onClick={() => toggle(opt.id)}
                    >
                      <span>{opt.label}</span>
                      <span className="tabular-nums text-gray-500">{n != null ? n : "…"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded font-medium"
                  onClick={apply}
                >
                  Застосувати
                </button>
                <button type="button" className="btn btn-xs btn-ghost" onClick={reset}>
                  Скинути
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
