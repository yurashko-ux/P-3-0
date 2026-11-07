"use client";

import { useEffect, useRef, useState } from "react";

export type PrettyOption = { value: string; label: string };

/**
 * Випадаючий список у стилі плиток Каси. Системний <select> на macOS не стилізується,
 * тому список свій: поле + квадратна кнопка зі стрілкою, меню — світла картка з тінню.
 */
export function PrettySelect({
  value,
  options,
  onChange,
  tint = "#eef2f7",
  className = "",
  active = false,
}: {
  value: string;
  options: PrettyOption[];
  onChange: (value: string) => void;
  /** Фон квадратної кнопки зі стрілкою */
  tint?: string;
  className?: string;
  /** Підсвітити поле (обрано значення в цій групі) */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Меню фіксоване: картка вікна гортається і не обрізає його
      const below = window.innerHeight - rect.bottom;
      const maxHeight = Math.min(280, Math.max(below, rect.top) - 12);
      const openUp = below < 200 && rect.top > below;
      setMenuStyle({
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 200),
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`flex h-8 w-full items-stretch overflow-hidden rounded-lg border bg-white text-left text-xs shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors ${
          active ? "border-blue-300 bg-blue-50/60" : "border-slate-200 hover:border-slate-300"
        } ${className}`}
        onClick={toggle}
      >
        <span className={`flex-1 truncate px-2.5 py-2 leading-4 ${active ? "font-medium text-blue-800" : "text-gray-900"}`}>
          {selected?.label ?? ""}
        </span>
        <span
          className="flex w-8 shrink-0 items-center justify-center border-l border-slate-200 text-gray-600"
          style={{ background: tint }}
          aria-hidden
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-[60] overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_28px_-10px_rgba(15,23,42,0.35)]"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs ${
                  isSelected ? "bg-blue-50 font-medium text-blue-800" : "text-gray-800 hover:bg-slate-50"
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
