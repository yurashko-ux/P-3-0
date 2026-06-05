"use client";

import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";

export type CampaignAudienceCounts = {
  total: number;
  activated: number;
  nonActivated: number;
};

const SQUARE_BASE =
  "inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 tabular-nums text-[11px] font-normal leading-none min-w-[1.25rem] min-h-[1.25rem] cursor-default";

const BADGE_ITEMS = [
  {
    key: "total",
    field: "total" as const,
    className: `${SQUARE_BASE} bg-white border border-gray-300 text-gray-900`,
    tooltip: (n: number) => `Усього клієнтів у кампанії: ${n}`,
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

type Props = {
  counts: CampaignAudienceCounts;
};

export function InactiveBaseCampaignAudienceBadges({ counts }: Props) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {BADGE_ITEMS.map(({ key, field, className, tooltip }) => {
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
