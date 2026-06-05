"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TelegramCanSendCounts, TelegramCanSendFilterValue } from "@/lib/inactive-base/telegram-can-send-filter";
import { FilterCheckboxOption } from "../../_components/FilterCheckboxOption";
import { FilterIconButton } from "../../_components/FilterIconButton";

const PANEL_CLASS =
  "bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px] max-h-[320px] overflow-y-auto pointer-events-auto";

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
  const hasPending = pending.length > 0;

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
            className={PANEL_CLASS}
            style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
          >
            <div className="p-2">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
                <span>Telegram — системні повідомлення</span>
              </div>
              <p className="text-[10px] text-gray-500 mb-2 px-2">
                Критерій: є <code className="text-[10px] bg-gray-100 px-1 rounded">telegramChatId</code> (клієнт у чаті
                з салоном).
              </p>
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
              <div className="flex gap-2 mt-2 px-0">
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
