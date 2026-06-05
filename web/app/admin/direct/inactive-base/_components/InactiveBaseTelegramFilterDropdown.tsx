"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TelegramCanSendCounts, TelegramCanSendFilterValue } from "@/lib/inactive-base/telegram-can-send-filter";
import { FilterIconButton } from "../../_components/FilterIconButton";

const OPTIONS: Array<{ id: TelegramCanSendFilterValue; label: string }> = [
  { id: "can", label: "Є Telegram id (можна слати)" },
  { id: "cannot", label: "Немає Telegram id" },
];

type Props = {
  value: TelegramCanSendFilterValue[];
  onChange: (next: TelegramCanSendFilterValue[]) => void;
  counts?: TelegramCanSendCounts | null;
};

export function InactiveBaseTelegramFilterDropdown({ value, onChange, counts }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<TelegramCanSendFilterValue[]>(value);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPanelPosition({ top: rect.bottom + 4, left: Math.max(8, rect.left - 180) });
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
        can: counts?.can ?? null,
        cannot: counts?.cannot ?? null,
      }) as Record<TelegramCanSendFilterValue, number | null>,
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

  const toggle = (id: TelegramCanSendFilterValue) => {
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div ref={anchorRef} className="inline-flex">
      <FilterIconButton
        active={hasActive}
        onClick={() => setIsOpen((o) => !o)}
        title="Фільтр Telegram: клієнти з telegramChatId (можна слати через Business)"
      />
      {isOpen &&
        panelPosition &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[9999] w-[280px] rounded-lg border border-base-300 bg-base-100 shadow-xl p-3 text-sm"
            style={{ top: panelPosition.top, left: panelPosition.left }}
          >
            <div className="font-semibold mb-2">Telegram — системні повідомлення</div>
            <p className="text-[11px] text-base-content/60 mb-2">
              Критерій: є <code className="text-xs">telegramChatId</code> (клієнт уже в чаті з салоном).
            </p>
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {OPTIONS.map((opt) => {
                const selected = pending.includes(opt.id);
                const n = countById[opt.id];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-base-200 text-left ${
                      selected ? "bg-blue-50 ring-1 ring-blue-200" : ""
                    }`}
                    onClick={() => toggle(opt.id)}
                  >
                    <span>{opt.label}</span>
                    <span className="tabular-nums text-xs opacity-70">{n != null ? n : "…"}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 mt-3 pt-2 border-t border-base-200">
              <button type="button" className="btn btn-xs btn-primary flex-1" onClick={apply}>
                Застосувати
              </button>
              <button type="button" className="btn btn-xs btn-ghost" onClick={reset}>
                Скинути
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
