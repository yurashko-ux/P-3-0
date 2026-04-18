// web/app/admin/direct/_components/CallbackReminderCell.tsx
// Колонка «Передзвонити»: іконка 📞 (не в лідах IG) + дата; стиль дати як у колонці «Запис».

"use client";

import { useDirectClientTableRowContext } from "./direct-client-table-row-context";
import type { DirectClient } from "@/lib/direct-types";
import { formatDateShortYear } from "./direct-client-table-formatters";

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

/** 📞 показуємо лише для клієнтів (не IG-лід «Повідомлення») та Binotel */
function showCallbackReminderPhoneEmoji(client: DirectClient): boolean {
  const ig = typeof client.instagramUsername === "string" ? client.instagramUsername : "";
  if (ig.startsWith("binotel_") || client.state === "binotel-lead") {
    return true;
  }
  if (client.state === "message") {
    return false;
  }
  return true;
}

export function CallbackReminderCell({ client }: Props) {
  const { onOpenCallbackReminder } = useDirectClientTableRowContext();
  const day = client.callbackReminderKyivDay ?? "";
  const todayYmd = kyivTodayYmd();
  const isDueToday = Boolean(day && day === todayYmd);
  const isPast = Boolean(day && day < todayYmd);
  const showPhone = showCallbackReminderPhoneEmoji(client);

  const open = () => onOpenCallbackReminder(client);

  const dateLabel =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? formatDateShortYear(`${day}T12:00:00.000Z`)
      : "";

  /** Як у колонці «Запис»: text-xs, font-medium, палітра today / past / майбутнє */
  const dateClassName = isDueToday
    ? "text-green-600 font-medium hover:underline disabled:hover:no-underline"
    : isPast
      ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline"
      : "text-blue-600 font-medium hover:underline disabled:hover:no-underline";

  return (
    <div
      className="flex flex-row items-center gap-1 min-w-0 max-w-full text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {showPhone ? (
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
      ) : null}
      {day ? (
        <button
          type="button"
          className={`p-0 tabular-nums text-left truncate text-xs ${dateClassName}`}
          title="Відкрити нагадування передзвону"
          onClick={open}
        >
          {dateLabel}
        </button>
      ) : !showPhone ? (
        <button
          type="button"
          className="p-0 text-xs text-blue-600 font-medium hover:underline"
          title="Додати нагадування передзвону"
          onClick={open}
        >
          додати
        </button>
      ) : null}
    </div>
  );
}
