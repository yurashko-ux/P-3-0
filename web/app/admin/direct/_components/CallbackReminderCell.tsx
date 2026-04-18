// web/app/admin/direct/_components/CallbackReminderCell.tsx
// Колонка «Передзвонити»: іконка + дата; редагування в модалці.

"use client";

import { useDirectClientTableRowContext } from "./direct-client-table-row-context";
import type { DirectClient } from "@/lib/direct-types";

const KYIV_TZ = "Europe/Kyiv";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Props = {
  client: DirectClient;
};

export function CallbackReminderCell({ client }: Props) {
  const { onOpenCallbackReminder } = useDirectClientTableRowContext();
  const day = client.callbackReminderKyivDay ?? "";
  const todayYmd = kyivTodayYmd();
  const isDueToday = Boolean(day && day === todayYmd);
  const isPast = Boolean(day && day < todayYmd);

  const open = () => onOpenCallbackReminder(client);

  const dateLabel =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? (() => {
          const [y, m, d] = day.split("-");
          return `${d}.${m}.${y.slice(-2)}`;
        })()
      : "";

  return (
    <div
      className="flex flex-row items-center gap-1 min-w-0 max-w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="btn btn-ghost btn-xs px-1 min-h-0 h-6 shrink-0"
        title="Передзвонити"
        aria-label="Відкрити нагадування передзвону"
        onClick={open}
      >
        <span className="text-base leading-none" aria-hidden>
          📞
        </span>
      </button>
      {day ? (
        <button
          type="button"
          className={`text-[10px] leading-none tabular-nums underline-offset-2 hover:underline text-left truncate ${
            isDueToday ? "text-amber-700 font-semibold" : isPast ? "text-rose-700" : "text-gray-800"
          }`}
          title="Відкрити нагадування передзвону"
          onClick={open}
        >
          {dateLabel}
        </button>
      ) : null}
    </div>
  );
}
