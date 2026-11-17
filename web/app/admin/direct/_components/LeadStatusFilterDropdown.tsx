// web/app/admin/direct/_components/LeadStatusFilterDropdown.tsx
// Фільтр колонки «Статус ліда» (сторінка Ліди) — у формі фільтрів Direct: чекбокси + кількість за період.

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilterIconButton } from "./FilterIconButton";
import { PILL_BASE, PILL_FIXED, StatusDot, pillStyle } from "./LeadChatStatusCell";

/** Ключ для лідів без статусу («Лід»). */
export const LEAD_STATUS_NONE = "__none__";

/** badgeKey = null — «Лід» (сіра таблетка без крапки). */
type Option = { id: string; label: string; count: number; badgeKey: string | null };

type Props = {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  total: number;
};

export function LeadStatusFilterDropdown({ options, selected, onChange, total }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(selected);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPending(selected), [selected]);

  useLayoutEffect(() => {
    if (!isOpen || !btnRef.current) return setPos(null);
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 290) });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setPending(selected);
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, selected]);

  const toggle = (id: string) =>
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="relative inline-block align-middle" ref={btnRef}>
      <FilterIconButton active={selected.length > 0} onClick={() => setIsOpen((v) => !v)} title="Фільтри для Статус ліда" />
      {isOpen && pos
        ? createPortal(
            <div
              ref={panelRef}
              className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px] max-h-[360px] overflow-y-auto font-normal normal-case"
              style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 999999 }}
            >
              <div className="p-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
                  <span>Фільтри: Статус ліда</span>
                  <span className="text-gray-500 font-normal">({total})</span>
                </div>
                <div className="space-y-1">
                  {options.map((o) => {
                    const on = pending.includes(o.id);
                    return (
                      // Рядок як у фільтрах Direct, але назва — та сама таблетка, що в колонці «Статус ліда».
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(o.id)}
                        className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between gap-2 hover:bg-base-200 transition-colors ${on ? "bg-blue-50" : ""}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex shrink-0 items-center justify-center w-3 h-3 rounded border ${on ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"}`}
                          >
                            {on ? (
                              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" aria-hidden>
                                <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : null}
                          </span>
                          <span className={`${PILL_BASE} ${PILL_FIXED} pointer-events-none`} style={pillStyle(o.badgeKey)}>
                            {o.badgeKey ? <StatusDot badgeKey={o.badgeKey} /> : null}
                            <span className="truncate min-w-0 flex-1 text-left">{o.label}</span>
                          </span>
                        </span>
                        <span className="text-gray-500 font-medium tabular-nums shrink-0">({o.count})</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(pending);
                      setIsOpen(false);
                    }}
                    className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium"
                  >
                    Застосувати
                  </button>
                  {selected.length > 0 || pending.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPending([]);
                        onChange([]);
                        setIsOpen(false);
                      }}
                      className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded transition-colors font-medium"
                    >
                      Очистити
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
