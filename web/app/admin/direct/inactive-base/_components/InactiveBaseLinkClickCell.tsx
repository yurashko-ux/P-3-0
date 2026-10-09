"use client";

import type { MouseEvent } from "react";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";
import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";

/** Ті самі розміри, що в InactiveBaseTelegramCounterPills. */
const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full px-1.5 py-0.5 tabular-nums text-[11px] font-normal leading-none min-w-[1.25rem]";

type Props = {
  hasTrackableLink: boolean;
  clicked: boolean;
  /** true — зелена галочка (клік у поточній кампанії); false — сіра (лише в попередніх). */
  clickedInCurrentCampaign: boolean;
  clickedAt: string | null;
  clickCount: number;
  /** У згорнутій групі — кількість клієнтів із переходом по посиланню. */
  groupLinkClickedCount?: number | null;
  hidden?: boolean;
  onOpenHistory?: () => void;
};

export function InactiveBaseLinkClickCell({
  hasTrackableLink,
  clicked,
  clickedInCurrentCampaign,
  clickedAt,
  clickCount,
  groupLinkClickedCount = null,
  hidden,
  onOpenHistory,
}: Props) {
  if (groupLinkClickedCount != null) {
    if (!hasTrackableLink) {
      return (
        <span className="text-[10px] text-base-content/40" title="У кампанії немає {{посилання}}">
          —
        </span>
      );
    }
    const count = groupLinkClickedCount;
    const tipText = `Клієнтів із переходом по посиланню: ${count}`;
    const pillClass =
      count === 0
        ? `${PILL_BASE} bg-gray-200 text-gray-900 cursor-default`
        : `${PILL_BASE} bg-lime-500 text-white cursor-default`;
    return (
      <InactiveBaseCounterHoverTip text={tipText}>
        <span className={pillClass} aria-label={tipText}>
          {count}
        </span>
      </InactiveBaseCounterHoverTip>
    );
  }

  if (hidden) {
    return <span className="text-base-content/40">—</span>;
  }
  if (!hasTrackableLink && !clicked) {
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
  const isCurrentCampaignClick = clickedInCurrentCampaign;
  const pillClass = isCurrentCampaignClick
    ? `${PILL_BASE} bg-lime-500 text-white`
    : `${PILL_BASE} bg-gray-200 text-gray-900`;
  const pillTitle = isCurrentCampaignClick
    ? clickCount > 1
      ? `Перехід по посиланню в цій кампанії: ${clickCount} разів, останній ${dateStr}. Клік — історія`
      : `Перехід по посиланню в цій кампанії: ${dateStr}. Клік — історія`
    : clickCount > 1
      ? `Перехід у попередній кампанії: ${clickCount} разів, останній ${dateStr}. Клік — історія`
      : `Перехід у попередній кампанії: ${dateStr}. Клік — історія`;

  const openHistory = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenHistory?.();
  };

  const pillContent = isCurrentCampaignClick && clickCount > 1 ? clickCount : "✓";

  if (!onOpenHistory) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5" title={pillTitle}>
        <span className={pillClass}>{pillContent}</span>
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
      <span className={pillClass}>{pillContent}</span>
      {dateStr !== "-" ? (
        <span className="text-[10px] leading-none opacity-60 tabular-nums pointer-events-none">
          {dateStr}
        </span>
      ) : null}
    </button>
  );
}
