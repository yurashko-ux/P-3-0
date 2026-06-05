"use client";

import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";

export type CampaignAudienceCounts = {
  total: number;
  activated: number;
  nonActivated: number;
};

/** Фіксований розмір під 2 цифри (навіть якщо одна). */
const SQUARE_BASE =
  "inline-flex items-center justify-center rounded-sm w-[1.75rem] h-[1.25rem] tabular-nums text-[11px] font-normal leading-none cursor-default shrink-0";

function badgeTooltips(scope: "кампанії" | "групі") {
  return [
    {
      key: "total",
      field: "total" as const,
      className: `${SQUARE_BASE} bg-white border border-gray-300 text-gray-900`,
      tooltip: (n: number) => `Усього клієнтів у ${scope}: ${n}`,
    },
    {
      key: "activated",
      field: "activated" as const,
      className: `${SQUARE_BASE} bg-yellow-400 text-gray-900`,
      tooltip: (n: number) => `Активовані (є telegramChatId, можна слати в Telegram): ${n}`,
    },
    {
      key: "nonActivated",
      field: "nonActivated" as const,
      className: `${SQUARE_BASE} bg-gray-200 text-gray-900`,
      tooltip: (n: number) => `Не активовані (немає telegramChatId): ${n}`,
    },
  ];
}

type Props = {
  counts: CampaignAudienceCounts;
  /** Підпис у tooltip: кампанія чи згорнута група в таблиці. */
  tooltipScope?: "кампанії" | "групі";
};

export function InactiveBaseCampaignAudienceBadges({
  counts,
  tooltipScope = "кампанії",
}: Props) {
  const items = badgeTooltips(tooltipScope);
  return (
    <span className="inline-flex items-center gap-0.5">
      {items.map(({ key, field, className, tooltip }) => {
        const count = counts[field];
        return (
          <InactiveBaseCounterHoverTip key={key} text={tooltip(count)}>
            <span className={className} aria-label={tooltip(count)}>
              {count}
            </span>
          </InactiveBaseCounterHoverTip>
        );
      })}
    </span>
  );
}
