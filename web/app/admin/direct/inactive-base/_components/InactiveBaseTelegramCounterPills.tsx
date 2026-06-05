"use client";

import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";

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

type PillKind = "manual" | "system" | "incoming";

const PILL_LABELS: Record<PillKind, string> = {
  manual: "Ручні вихідні",
  system: "Системні вихідні",
  incoming: "Вхідні",
};

function buildPillTooltip(kind: PillKind, count: number, scopeHint: string): string {
  if (scopeHint === "клієнтів у групі") {
    return `Клієнтів із ${PILL_LABELS[kind].toLowerCase()}: ${count}`;
  }
  if (scopeHint === "після join кампанії") {
    return `${PILL_LABELS[kind]} (після join кампанії): ${count}`;
  }
  return `${PILL_LABELS[kind]} (за весь час): ${count}`;
}

const PILL_ITEMS = [
  {
    key: "manual",
    kind: "manual" as const,
    field: "outgoingManualCount" as const,
    activeClass: "bg-lime-500 text-white",
  },
  {
    key: "system",
    kind: "system" as const,
    field: "outgoingSystemCount" as const,
    activeClass: "bg-[#2AABEE] text-white",
  },
  {
    key: "incoming",
    kind: "incoming" as const,
    field: "incomingCount" as const,
    activeClass: "bg-orange-500 text-white",
  },
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
      {PILL_ITEMS.map(({ key, kind, field, activeClass }) => {
        const count = counts[field];
        const tipText = buildPillTooltip(kind, count, scopeHint);
        const className = interactive
          ? `${pillClass(count, activeClass)} hover:opacity-80 transition-opacity cursor-pointer`
          : `${pillClass(count, activeClass)} cursor-default`;

        const inner = interactive && onPillClick ? (
          <button type="button" className={className} onClick={onPillClick} aria-label={tipText}>
            {count}
          </button>
        ) : (
          <span className={className} aria-label={tipText}>
            {count}
          </span>
        );

        return (
          <InactiveBaseCounterHoverTip key={key} text={tipText}>
            {inner}
          </InactiveBaseCounterHoverTip>
        );
      })}
    </span>
  );
}
