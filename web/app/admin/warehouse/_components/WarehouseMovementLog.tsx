"use client";

import type { WarehouseMovementKind, WarehouseMovementLogRow } from "@/lib/warehouse/movement-log-types";

const KIND_META: Record<
  WarehouseMovementKind,
  { label: string; className: string; path?: string; glyph?: string }
> = {
  intake: {
    label: "Прийомка",
    className: "text-blue-600",
    path: "M6 2.5v7M3.2 7.2 6 10l2.8-2.8",
  },
  write_off: {
    label: "Списання",
    className: "text-red-600",
    path: "M9.5 6h-7M4.8 3.2 2 6l2.8 2.8",
  },
  sale: {
    label: "Продаж",
    className: "text-emerald-600",
    glyph: "$",
  },
};

function MovementMark({ kind, inheritColor }: { kind: WarehouseMovementKind; inheritColor?: boolean }) {
  const meta = KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${inheritColor ? "" : meta.className}`}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.glyph ? (
        <span className="text-[13px] font-extrabold leading-none">$</span>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d={meta.path ?? ""} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function formatDay(kyivDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(kyivDay);
  if (!m) return kyivDay;
  return `${m[3]}.${m[2]}`;
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

export function WarehouseMovementLog({
  rows,
  kinds,
  onKindsChange,
}: {
  rows: WarehouseMovementLogRow[];
  kinds: WarehouseMovementKind[];
  onKindsChange: (next: WarehouseMovementKind[]) => void;
}) {
  const selected = new Set(kinds);
  const showAll = kinds.length === 0;
  const visible = showAll ? rows : rows.filter((row) => selected.has(row.kind));

  const toggle = (kind: WarehouseMovementKind) => {
    if (selected.has(kind)) {
      onKindsChange(kinds.filter((k) => k !== kind));
      return;
    }
    onKindsChange([...kinds, kind]);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-1 bg-slate-300 px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-900">Рух за місяць</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={`px-1.5 h-6 rounded-md text-[10px] font-medium border shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
              showAll ? "bg-[#dbe7f5] text-blue-800 border-slate-200/80" : "bg-white/70 text-gray-600 border-slate-200/80"
            }`}
            onClick={() => onKindsChange([])}
            title="Усі джерела"
          >
            Усі
          </button>
          {(Object.keys(KIND_META) as WarehouseMovementKind[]).map((kind) => {
            const meta = KIND_META[kind];
            const on = selected.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`inline-flex items-center justify-center w-6 h-6 rounded-md border shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
                  on ? `${meta.className} bg-white border-current` : "bg-white/70 text-gray-400 border-slate-200/80"
                }`}
                title={meta.label}
                aria-pressed={on}
                onClick={() => toggle(kind)}
              >
                <MovementMark kind={kind} inheritColor />
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-2 py-1.5">
        {visible.length === 0 ? (
          <p className="text-[11px] text-gray-500 py-2 text-center">Немає руху за цей місяць.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[12px_34px_minmax(0,1fr)_auto] items-center gap-1 py-1 text-[10px] leading-tight"
                title={`${KIND_META[row.kind].label} · ${row.code} · ${formatCost(row.costUah)} грн`}
              >
                <MovementMark kind={row.kind} />
                <span className="tabular-nums text-gray-500">{formatDay(row.kyivDay)}</span>
                <span className="truncate font-medium">{row.code}</span>
                <span className="tabular-nums font-semibold text-gray-700 shrink-0">{formatCost(row.costUah)} грн</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
