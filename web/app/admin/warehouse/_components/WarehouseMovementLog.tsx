"use client";

import type { WarehouseMovementKind, WarehouseMovementLogRow } from "@/lib/warehouse/movement-log-types";

const KIND_META: Record<
  WarehouseMovementKind,
  { label: string; className: string; path: string }
> = {
  intake: {
    label: "Прийомка",
    className: "text-emerald-600",
    path: "M6 2.5v7M3.2 7.2 6 10l2.8-2.8",
  },
  write_off: {
    label: "Списання",
    className: "text-red-600",
    path: "M9.5 6h-7M4.8 3.2 2 6l2.8 2.8",
  },
  sale: {
    label: "Продаж",
    className: "text-orange-500",
    path: "M2.5 6h7M7.2 3.2 10 6l-2.8 2.8",
  },
};

function MovementMark({ kind }: { kind: WarehouseMovementKind }) {
  const meta = KIND_META[kind];
  return (
    <span className={`inline-flex shrink-0 ${meta.className}`} title={meta.label} aria-label={meta.label}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d={meta.path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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
    <div className="bg-white border rounded-xl p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-gray-700">Рух</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={`px-1.5 h-6 rounded text-[10px] border ${
              showAll ? "bg-blue-50 text-blue-700 border-blue-400" : "text-gray-500 border-gray-300"
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
                className={`inline-flex items-center justify-center w-6 h-6 rounded border ${
                  on ? `${meta.className} bg-gray-50 border-current` : "text-gray-400 border-gray-300"
                }`}
                title={meta.label}
                aria-pressed={on}
                onClick={() => toggle(kind)}
              >
                <MovementMark kind={kind} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto -mx-0.5">
        {visible.length === 0 ? (
          <p className="text-[11px] text-gray-500 py-2">Немає руху за цей місяць.</p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[12px_34px_minmax(0,1fr)_auto] items-center gap-1 text-[11px] leading-tight"
                title={`${KIND_META[row.kind].label} · ${row.code} · ${formatCost(row.costUah)} грн`}
              >
                <MovementMark kind={row.kind} />
                <span className="tabular-nums text-gray-500">{formatDay(row.kyivDay)}</span>
                <span className="truncate font-medium">{row.code}</span>
                <span className="tabular-nums text-gray-700 shrink-0">{formatCost(row.costUah)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
