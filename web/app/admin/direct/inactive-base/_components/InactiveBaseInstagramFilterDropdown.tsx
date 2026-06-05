"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  InstInstagramCounts,
  InstInstagramFilterValue,
} from "@/lib/inactive-base/instagram-presence-filter";
import { FilterCheckboxOption } from "../../_components/FilterCheckboxOption";
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
  const hasPending = pending.length > 0;

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
            <div className="p-2">
              <div className="space-y-1">
                {OPTIONS.map((opt) => (
                  <FilterCheckboxOption
                    key={opt.id}
                    label={opt.label}
                    selected={pending.includes(opt.id)}
                    count={countById[opt.id]}
                    onClick={() => toggle(opt.id)}
                  />
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded font-medium"
                  onClick={apply}
                >
                  Застосувати
                </button>
                {(hasActive || hasPending) && (
                  <button
                    type="button"
                    className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded font-medium"
                    onClick={reset}
                  >
                    Очистити
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
