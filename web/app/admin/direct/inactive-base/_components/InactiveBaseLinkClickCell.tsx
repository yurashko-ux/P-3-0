"use client";

import type { MouseEvent } from "react";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";

/** Ті самі розміри, що в InactiveBaseTelegramCounterPills. */
const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full px-1.5 py-0.5 tabular-nums text-[11px] font-normal leading-none min-w-[1.25rem]";

type Props = {
  hasTrackableLink: boolean;
  clicked: boolean;
  clickedAt: string | null;
  clickCount: number;
  hidden?: boolean;
  onOpenHistory?: () => void;
};

export function InactiveBaseLinkClickCell({
  hasTrackableLink,
  clicked,
  clickedAt,
  clickCount,
  hidden,
  onOpenHistory,
}: Props) {
  if (hidden) {
    return <span className="text-base-content/40">—</span>;
  }
  if (!hasTrackableLink) {
    return (
      <span className="text-[10px] text-base-content/40" title="У кампанії немає {{посилання}}">
        —
      </span>
    );
  }
  if (!clicked) {
    return (
      <span className={`${PILL_BASE} bg-gray-200 text-gray-900`} title="Посилання ще не відкривали">
        0
      </span>
    );
  }

  const dateStr = formatDateDDMMYY(clickedAt);
  const pillTitle =
    clickCount > 1
      ? `Перехід по посиланню: ${clickCount} разів, останній ${dateStr}. Клік — історія`
      : `Перехід по посиланню: ${dateStr}. Клік — історія`;

  const openHistory = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenHistory?.();
  };

  if (!onOpenHistory) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5" title={pillTitle}>
        <span className={`${PILL_BASE} bg-lime-500 text-white`}>
          {clickCount > 1 ? clickCount : "✓"}
        </span>
        {dateStr !== "-" ? (
          <span className="text-[10px] leading-none opacity-60 tabular-nums">{dateStr}</span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex flex-col items-start gap-0.5 hover:opacity-80 transition-opacity cursor-pointer text-left"
      title={pillTitle}
      aria-label="Історія переходів по посиланнях"
      onClick={openHistory}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className={`${PILL_BASE} bg-lime-500 text-white`}>{clickCount > 1 ? clickCount : "✓"}</span>
      {dateStr !== "-" ? (
        <span className="text-[10px] leading-none opacity-60 tabular-nums pointer-events-none">
          {dateStr}
        </span>
      ) : null}
    </button>
  );
}
