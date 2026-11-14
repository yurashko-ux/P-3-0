// Стиль розділу — як у Фінансах і Касі: пастельні картки, м'які тіні, сірі акценти без синіх кнопок.

import type { ProcessKind } from "@/lib/business-processes/config";

/** Тон картки за типом процесу (як TYPE_TINT у документах Каси). */
export const KIND_TINT: Record<ProcessKind, string> = {
  task_report: "#e3edf9",
  client_message: "#e5f2e9",
};

const SHADOW_SOFT = "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)]";

export const UI = {
  card: "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_18px_-12px_rgba(15,23,42,0.2)]",
  block: "space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3",
  blockTitle: "text-[10px] font-semibold uppercase tracking-wide text-gray-500",
  row: "grid grid-cols-1 gap-1 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-2",
  rowTop: "grid grid-cols-1 gap-1 sm:grid-cols-[120px_1fr] sm:items-start sm:gap-2",
  label: "text-xs text-gray-600",
  hint: "text-[10px] text-gray-500",
  input:
    "h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-gray-400",
  inputAuto:
    "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-gray-400",
  textarea:
    "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-slate-400 focus:outline-none",
  check: "h-3.5 w-3.5 cursor-pointer accent-[#5c6a7c]",
  /** Кнопка на тонованій шапці картки. */
  headerButton:
    "rounded-lg border border-slate-300/80 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-white disabled:opacity-50",
  headerDanger:
    "rounded-lg border border-red-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50",
  /** Головна дія — у тон картки (колір задається style). */
  tintButton: `h-8 rounded-lg border border-slate-200/80 px-4 text-xs font-medium text-gray-900 ${SHADOW_SOFT} transition-[filter] hover:brightness-[0.96] disabled:opacity-60`,
  plainButton: `h-8 rounded-lg border border-slate-200/80 bg-white px-4 text-xs font-medium text-gray-700 ${SHADOW_SOFT} hover:bg-slate-50 disabled:opacity-60`,
  addButton:
    "h-8 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-slate-50 disabled:opacity-50",
  iconButton: "h-7 w-7 rounded-md text-xs text-gray-500 hover:bg-slate-100 disabled:opacity-30",
  iconDanger: "h-7 w-7 rounded-md text-sm text-red-500 hover:bg-red-50",
  error: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800",
  warn: "text-[11px] text-amber-700",
};

/** Сегментний перемикач (як вибір Дохід / Розхід у Касі). */
export const segmentWrap = "inline-flex gap-1 rounded-xl bg-[#ebedf2] p-0.5";
export function segment(on: boolean): string {
  return `rounded-lg px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    on ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_3px_8px_-4px_rgba(15,23,42,0.25)]" : "text-gray-600 hover:text-gray-900"
  }`;
}

/** Плашка-вибір: дні тижня, контролери, підстановки. */
export function pill(on: boolean): string {
  return `rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
    on
      ? "border-[#5c6a7c] bg-[#5c6a7c] text-white shadow-[0_1px_2px_rgba(15,23,42,0.15)]"
      : "border-slate-200 bg-white text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:bg-slate-50"
  }`;
}
