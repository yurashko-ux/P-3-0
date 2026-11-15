"use client";

// Стиль розділу Склад — як у Касі: плитки з тінню, дрібні таблиці в білій картці, вікна з кольоровою шапкою.

import { useEffect, type ReactNode } from "react";

export { PrettySelect, type PrettyOption } from "@/app/admin/finance/cash/PrettySelect";

export const tileFaceClass =
  "relative flex w-full flex-col items-center justify-center min-h-[4.5rem] rounded-xl border border-slate-200/80 px-2 py-1.5 text-center text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-8px_rgba(15,23,42,0.28)]";

export const tileButtonClass = `${tileFaceClass} cursor-pointer select-none transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_14px_24px_-8px_rgba(15,23,42,0.32)] active:translate-y-px active:scale-[0.97] active:brightness-[0.97] active:shadow-[inset_0_2px_8px_rgba(15,23,42,0.16),0_1px_2px_rgba(15,23,42,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400`;

export const tileGridClass = "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2";

export const cardClass = "rounded-xl border border-gray-200 bg-white shadow-sm";

/** Таблиця як у Касі: 10px, сірий заголовок колонок великими літерами. */
export const tableClass = "w-full text-left text-[10px]";
export const theadRowClass = "bg-gray-50 text-[9px] uppercase text-gray-500";
export const thClass = "px-2 py-1 font-medium";
export const tdClass = "px-2 py-1";
export const trClass = "border-t border-gray-100";
/** Рядок-заголовок групи (день, тип) — як шапка дня в Касі. */
export const groupRowClass = "bg-slate-300 text-[10px] text-gray-900";

/** Поле без ширини — для полів фіксованої ширини (w-20 тощо). */
export const fieldBaseClass =
  "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none";
export const fieldClass = `${fieldBaseClass} w-full`;
export const labelClass = "text-xs text-gray-600";
export const formRowClass = "grid grid-cols-[150px_1fr] items-center gap-2";
export const inlineAddClass =
  "h-8 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-gray-700 hover:bg-slate-100 disabled:opacity-60";
export const ghostButtonClass = "h-8 rounded-lg px-3 text-xs text-gray-600 hover:bg-slate-100";

/** Основна кнопка з відтінком документа (як «Зберегти» в картці Каси). */
export function tintButtonClass(): string {
  return "h-8 rounded-lg border border-slate-200/80 px-4 text-xs font-medium text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] transition-[filter] hover:brightness-[0.96] disabled:opacity-60";
}

/** Відтінки типів документів складу — у палітрі Каси. */
export const DOC_TINT = {
  hair: "#f6efdf",
  goods: "#e5f2e9",
  inventory: "#e3edf9",
  write_off: "#f8ebe8",
  transfer: "#f5f3f7",
} as const;

export type WarehouseDocKind = keyof typeof DOC_TINT;

export function Banner({ tone, children }: { tone: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  const cls = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
  }[tone];
  return <div className={`rounded-lg border px-2.5 py-1.5 text-xs ${cls}`}>{children}</div>;
}

export function StatusPill({ tone, children, title }: { tone: "ok" | "error" | "muted"; children: ReactNode; title?: string }) {
  const dot = { ok: "bg-green-500", error: "bg-red-500", muted: "bg-gray-400" }[tone];
  const text = { ok: "text-gray-700", error: "text-red-700", muted: "text-gray-500" }[tone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${text}`} title={title}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** Вікно документа: кольорова шапка з перемикачем типів, прокручуване тіло, кнопки внизу. */
export function WarehouseModal({
  tint,
  title,
  tabs,
  activeTab,
  onTab,
  onClose,
  children,
  footer,
  wide,
}: {
  tint: string;
  title?: string;
  tabs?: Array<{ id: string; label: string }>;
  activeTab?: string;
  onTab?: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className={`flex max-h-[92vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_18px_40px_-12px_rgba(15,23,42,0.45)]`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ background: tint }}>
          {tabs && tabs.length > 0 ? (
            <div className="flex flex-wrap gap-1 rounded-xl bg-white/50 p-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    tab.id === activeTab ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                  onClick={() => onTab?.(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          )}
          <button
            type="button"
            className="flex h-7 w-8 shrink-0 items-center justify-center rounded-md bg-[#f06ba6] text-white shadow-[0_1px_2px_rgba(15,23,42,0.15)] transition hover:bg-[#e2548f] active:scale-95"
            onClick={onClose}
            aria-label="Закрити"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}
