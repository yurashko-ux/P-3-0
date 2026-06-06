"use client";

import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";

export type InstagramMessageCounts = {
  incomingCount: number;
  outgoingCount: number;
};

const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full w-[1.75rem] h-[1.25rem] tabular-nums text-[11px] font-normal leading-none shrink-0";

function pillClass(count: number, activeClass: string): string {
  return count === 0 ? `${PILL_BASE} bg-gray-200 text-gray-900` : `${PILL_BASE} ${activeClass}`;
}

type PillKind = "incoming" | "outgoing";

const PILL_LABELS: Record<PillKind, string> = {
  incoming: "Вхідні",
  outgoing: "Вихідні",
};

function buildPillTooltip(kind: PillKind, count: number, scopeHint: string): string {
  if (scopeHint === "клієнтів у групі") {
    return `Клієнтів із ${PILL_LABELS[kind].toLowerCase()} Instagram: ${count}`;
  }
  if (scopeHint === "після join кампанії") {
    return `${PILL_LABELS[kind]} Instagram (після join кампанії): ${count}`;
  }
  return `${PILL_LABELS[kind]} Instagram (за весь час): ${count}`;
}

const PILL_ITEMS = [
  {
    key: "incoming",
    kind: "incoming" as const,
    field: "incomingCount" as const,
    activeClass: "bg-green-500 text-white",
  },
  {
    key: "outgoing",
    kind: "outgoing" as const,
    field: "outgoingCount" as const,
    activeClass: "bg-orange-500 text-white",
  },
];

type Props = {
  counts: InstagramMessageCounts;
  scopeHint?: string;
  interactive?: boolean;
  onPillClick?: () => void;
};

export function InactiveBaseInstagramCounterPills({
  counts,
  scopeHint = "за весь час",
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

        const inner =
          interactive && onPillClick ? (
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
