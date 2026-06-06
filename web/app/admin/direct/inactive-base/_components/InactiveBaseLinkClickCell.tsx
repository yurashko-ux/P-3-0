"use client";

import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";

type Props = {
  hasTrackableLink: boolean;
  clicked: boolean;
  clickedAt: string | null;
  clickCount: number;
  hidden?: boolean;
};

export function InactiveBaseLinkClickCell({
  hasTrackableLink,
  clicked,
  clickedAt,
  clickCount,
  hidden,
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
      <span
        className="inline-flex items-center rounded-full bg-gray-200 text-gray-700 px-2 py-0.5 text-[11px] tabular-nums"
        title="Посилання ще не відкривали"
      >
        0
      </span>
    );
  }

  const dateStr = formatDateDDMMYY(clickedAt);
  return (
    <span
      className="inline-flex flex-col items-start gap-0.5"
      title={
        clickCount > 1
          ? `Перехід по посиланню: ${clickCount} разів, останній ${dateStr}`
          : `Перехід по посиланню: ${dateStr}`
      }
    >
      <span className="inline-flex items-center rounded-full bg-lime-500 text-white px-2 py-0.5 text-[11px] font-medium tabular-nums">
        {clickCount > 1 ? clickCount : "✓"}
      </span>
      {dateStr !== "-" ? (
        <span className="text-[10px] leading-none opacity-60 tabular-nums">{dateStr}</span>
      ) : null}
    </span>
  );
}
