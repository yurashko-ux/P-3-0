"use client";

export type TelegramActiveClientCounts = {
  outgoingManualCount: number;
  outgoingSystemCount: number;
  incomingCount: number;
};

const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full px-1.5 py-0.5 tabular-nums text-[11px] font-normal leading-none min-w-[1.25rem]";

function pillClass(count: number, activeClass: string): string {
  return count === 0 ? `${PILL_BASE} bg-gray-200 text-gray-900` : `${PILL_BASE} ${activeClass}`;
}

const PILL_ITEMS = [
  { key: "manual", field: "outgoingManualCount" as const, activeClass: "bg-lime-500 text-white", label: "Ручні вихідні" },
  { key: "system", field: "outgoingSystemCount" as const, activeClass: "bg-[#2AABEE] text-white", label: "Системні вихідні" },
  { key: "incoming", field: "incomingCount" as const, activeClass: "bg-orange-500 text-white", label: "Вхідні" },
];

type Props = {
  counts: TelegramActiveClientCounts;
  scopeHint?: string;
  interactive?: boolean;
  onPillClick?: () => void;
};

export function InactiveBaseTelegramCounterPills({
  counts,
  scopeHint = "клієнтів у групі",
  interactive = false,
  onPillClick,
}: Props) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {PILL_ITEMS.map(({ key, field, activeClass, label }) => {
        const count = counts[field];
        const title = interactive
          ? `${label} (${scopeHint}): ${count}`
          : `${label}: ${count} ${scopeHint}`;
        const className = pillClass(count, activeClass);

        if (interactive && onPillClick) {
          return (
            <button
              key={key}
              type="button"
              className={`${className} hover:opacity-80 transition-opacity`}
              onClick={onPillClick}
              title={title}
            >
              {count}
            </button>
          );
        }

        return (
          <span key={key} className={className} title={title}>
            {count}
          </span>
        );
      })}
    </span>
  );
}
