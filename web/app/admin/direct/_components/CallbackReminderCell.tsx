// web/app/admin/direct/_components/CallbackReminderCell.tsx
// Колонка «Передзвонити»: у IG-лідів порожньо; інакше або дата, або 📞 (не обидва).

"use client";

import { useDirectClientTableRowContext } from "./direct-client-table-row-context";
import type { DirectClient } from "@/lib/direct-types";
import {
  formatDateDDMMYY,
  formatDateDDMMYYHHMM,
  formatDateShortYear,
} from "./direct-client-table-formatters";
import { WithCornerRedDot } from "./DirectClientTableAvatar";

const KYIV_TZ = "Europe/Kyiv";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function kyivYmdFromIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: KYIV_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

const BINOTEL_SUCCESS = ["ANSWER", "VM-SUCCESS", "SUCCESS"];

type Props = {
  client: DirectClient;
  /** Червона крапка (одна на рядок): winningKey === callbackReminder */
  showActivityDot?: boolean;
};

/** У колонці нічого не показуємо для IG-лідів (стан message); Binotel — показуємо як завжди */
function isIgLeadHideCallbackColumn(client: DirectClient): boolean {
  const ig = typeof client.instagramUsername === "string" ? client.instagramUsername : "";
  if (ig.startsWith("binotel_") || client.state === "binotel-lead") {
    return false;
  }
  return client.state === "message";
}

function binotelOutboundSuccessRelief(client: DirectClient): boolean {
  const rawType = (client as { binotelLatestCallType?: string | null }).binotelLatestCallType;
  const outgoing = Boolean(rawType && rawType !== "incoming");
  const disp = String((client as { binotelLatestCallDisposition?: string | null }).binotelLatestCallDisposition || "");
  const success = BINOTEL_SUCCESS.includes(disp);
  return outgoing && success;
}

export function CallbackReminderCell({ client, showActivityDot = false }: Props) {
  const { onOpenCallbackReminder } = useDirectClientTableRowContext();

  if (isIgLeadHideCallbackColumn(client)) {
    return <div className="min-h-[1.25rem]" aria-hidden onClick={(e) => e.stopPropagation()} />;
  }

  const day = client.callbackReminderKyivDay ?? "";
  const todayYmd = kyivTodayYmd();
  const isScheduledToday = Boolean(day && day === todayYmd);
  const isPast = Boolean(day && day < todayYmd);
  const isFuture = Boolean(day && day > todayYmd);

  const h = client.callbackReminderHistory;
  const lastEntry =
    Array.isArray(h) && h.length > 0 ? h[h.length - 1] : null;
  const lastCreatedAt = lastEntry?.createdAt;
  const lastSavedKyivDay = lastCreatedAt ? kyivYmdFromIso(lastCreatedAt) : "";
  const savedToday = Boolean(lastSavedKyivDay && lastSavedKyivDay === todayYmd);

  const hasOutboundRelief =
    Boolean(day && day >= todayYmd) && binotelOutboundSuccessRelief(client);

  const open = () => onOpenCallbackReminder(client);

  const dateLabel =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? formatDateShortYear(`${day}T12:00:00.000Z`)
      : "";

  const lastChangeLine = lastCreatedAt ? formatDateDDMMYY(lastCreatedAt) : "-";
  const lastChangeTitle = lastCreatedAt
    ? `Остання зміна: ${formatDateDDMMYYHHMM(lastCreatedAt)}`
    : undefined;

  /** Пріоритет: релief Binotel > дедлайн сьогодні (червоний) > прострочено (amber) > збережено сьогодні (сірий) > майбутнє (синій) */
  const pillShellClass = "rounded-md px-1.5 py-0.5 tabular-nums text-xs font-medium leading-none inline-flex max-w-full min-w-0";

  let pillClassName = pillShellClass;
  let labelClassName = "truncate text-left";

  if (hasOutboundRelief) {
    pillClassName += " bg-transparent";
    labelClassName += " text-gray-600 hover:underline";
  } else if (isScheduledToday) {
    pillClassName += " bg-red-200 text-red-900";
    labelClassName += " hover:underline";
  } else if (isPast) {
    pillClassName += " bg-amber-100 text-amber-900";
    labelClassName += " hover:underline";
  } else if (savedToday) {
    pillClassName += " bg-gray-200 text-gray-900";
    labelClassName += " hover:underline";
  } else if (isFuture || day) {
    labelClassName += " text-blue-600 hover:underline";
  }

  const dotTitle = "Тригер: змінилось нагадування передзвону";
  const dotClassName = "-top-[5px] -right-[4px]";

  const secondLine =
    lastChangeLine !== "-" ? (
      <span
        className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left"
        title={lastChangeTitle}
      >
        {lastChangeLine}
      </span>
    ) : null;

  /** Або дата, або трубка — не разом */
  if (day && dateLabel) {
    return (
      <div
        className="flex flex-col items-start gap-0.5 min-w-0 max-w-full text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <WithCornerRedDot show={showActivityDot} title={dotTitle} dotClassName={dotClassName}>
          <button
            type="button"
            className="p-0 text-left"
            title="Відкрити нагадування передзвону"
            onClick={open}
          >
            <span className={pillClassName}>
              <span className={labelClassName}>{dateLabel}</span>
            </span>
          </button>
        </WithCornerRedDot>
        {secondLine}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-0.5 min-w-0 max-w-full text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-row items-center gap-1 min-w-0 max-w-full">
        <WithCornerRedDot show={showActivityDot} title={dotTitle} dotClassName={dotClassName}>
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
        </WithCornerRedDot>
      </div>
      {secondLine}
    </div>
  );
}
