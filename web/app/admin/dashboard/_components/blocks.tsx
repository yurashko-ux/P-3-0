// Однакові блоки дашборду: підпис, одна головна цифра, кілька рядків пояснення.
"use client";

import type { ReactNode } from "react";

const numberFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export function formatInt(value: number): string {
  return numberFormat.format(Math.round(value));
}

export function formatUah(value: number): string {
  return `${formatInt(value)} ₴`;
}

export function formatUsd(value: number): string {
  return `${formatInt(value)} $`;
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export type BlockRow = {
  label: string;
  value: string;
  /** warn — сигнал, на який варто глянути; muted — другорядний рядок. */
  tone?: "warn" | "muted";
};

type BlockProps = {
  label: string;
  value: string;
  /** Дрібний підпис під головною цифрою. */
  sub?: string;
  rows?: BlockRow[];
  /** Пояснення внизу блоку (наприклад, чого бракує в даних). */
  note?: string;
  noteTone?: "warn" | "muted";
  hint?: string;
};

export function Block({ label, value, sub, rows = [], note, noteTone = "muted", hint }: BlockProps) {
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4" title={hint}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-[28px] font-semibold leading-tight tabular-nums text-slate-900">{value}</div>
      <div className="min-h-[18px] text-xs text-slate-500">{sub}</div>
      {rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className={row.tone === "warn" ? "font-medium text-red-700" : "text-slate-600"}>{row.label}</dt>
              <dd
                className={[
                  "whitespace-nowrap tabular-nums",
                  row.tone === "warn"
                    ? "font-semibold text-red-700"
                    : row.tone === "muted"
                      ? "text-slate-500"
                      : "font-medium text-slate-900",
                ].join(" ")}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {note && (
        <p className={`mt-3 text-[11px] leading-snug ${noteTone === "warn" ? "text-amber-700" : "text-slate-400"}`}>
          {note}
        </p>
      )}
    </section>
  );
}

/** Блок-список: назва, кількість і сума; смужка показує частку від найбільшого рядка. */
export function ListBlock({
  label,
  items,
  empty,
  footer,
}: {
  label: string;
  items: { title: string; meta?: string; value: string; share?: number | null }[];
  empty: string;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <li key={item.title}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-800" title={item.title}>
                  {item.title}
                </span>
                <span className="whitespace-nowrap font-medium tabular-nums text-slate-900">{item.value}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  {item.share != null && (
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${Math.max(2, Math.min(100, item.share * 100))}%` }}
                    />
                  )}
                </div>
                {item.meta && <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-500">{item.meta}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
