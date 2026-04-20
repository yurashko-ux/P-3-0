// web/app/admin/direct/_components/CallbackReminderCell.tsx
// Колонка «Передзвонити»: у IG-лідів порожньо; `📞` надсилає телефон адмінам; 💬 без дати — відкриває модалку.

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

const COMMENT_TOOLTIP_MAX = 200;

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

/** Нотатка до поточного дедлайну: найновіший запис історії з тим самим scheduledKyivDay, що й callbackReminderKyivDay. */
function activeCommentTooltip(client: DirectClient): string | null {
  const day = (client.callbackReminderKyivDay ?? "").trim();
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const h = client.callbackReminderHistory;
  if (!Array.isArray(h) || h.length === 0) return null;
  const matching = h.filter((e) => {
    const s = e.scheduledKyivDay;
    if (s == null || s === "") return false;
    return String(s).trim() === day;
  });
  if (matching.length === 0) return null;
  matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const note = (matching[0].note || "").trim();
  if (!note) return null;
  return note.length > COMMENT_TOOLTIP_MAX ? `${note.slice(0, COMMENT_TOOLTIP_MAX)}…` : note;
}

export function CallbackReminderCell({ client, showActivityDot = false }: Props) {
  const { onOpenCallbackReminder, onSendClientPhoneToAdminTelegram } = useDirectClientTableRowContext();

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

  /** Успішний вихідний знімає акцент для майбутніх/минулих дедлайнів (не для «сьогодні» — див. пріоритет стилів нижче). */
  const hasOutboundRelief = Boolean(day) && binotelOutboundSuccessRelief(client);

  const commentTooltip = activeCommentTooltip(client);

  const open = () => onOpenCallbackReminder(client);
  const sendPhoneToTelegram = () => {
    void onSendClientPhoneToAdminTelegram(client);
  };

  const dateLabel =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? formatDateShortYear(`${day}T12:00:00.000Z`)
      : "";

  const lastChangeLine = lastCreatedAt ? formatDateDDMMYY(lastCreatedAt) : "-";
  const lastChangeTitle = lastCreatedAt
    ? `Остання зміна: ${formatDateDDMMYYHHMM(lastCreatedAt)}`
    : undefined;

  /** Пріоритет: дедлайн на сьогодні (яскраво-червоний) > остання зміна сьогодні (сірий) > relief > прострочено > майбутнє */
  const pillShellClass = "rounded-md px-1.5 py-0.5 tabular-nums text-xs font-medium leading-none inline-flex max-w-full min-w-0";

  let pillClassName = pillShellClass;
  let labelClassName = "truncate text-left";

  if (isScheduledToday) {
    pillClassName += " bg-red-600 text-white shadow-sm";
    labelClassName += " hover:underline";
  } else if (savedToday) {
    pillClassName += " bg-gray-200 text-gray-900";
    labelClassName += " hover:underline";
  } else if (hasOutboundRelief) {
    pillClassName += " bg-transparent";
    labelClassName += " text-gray-600 hover:underline";
  } else if (isPast) {
    pillClassName += " bg-red-200 text-red-900";
    labelClassName += " hover:underline";
  } else if (isFuture || day) {
    labelClassName += " text-blue-600 hover:underline";
  }

  const dotTitle = "Тригер: змінилось нагадування передзвону";
  const dotClassName = "-top-[5px] -right-[4px]";

  const creationDateUnderDeadline =
    lastChangeLine !== "-" ? (
      <span
        className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left w-full self-start pl-0"
        title={lastChangeTitle}
      >
        {lastChangeLine}
      </span>
    ) : null;

  /** Колонка під 💬 завжди однакової ширини — пігулка не зміщується, коли коментаря немає */
  const commentIconSlot = (
    <span
      className="shrink-0 inline-flex min-w-[14px] w-4 justify-center items-center text-[12px] leading-none"
      aria-hidden={!commentTooltip}
    >
      {commentTooltip ? (
        <span title={commentTooltip} aria-label="Є коментар до поточного дедлайну" className="opacity-90">
          💬
        </span>
      ) : (
        <span className="invisible select-none pointer-events-none" aria-hidden>
          💬
        </span>
      )}
    </span>
  );

  /** Мінімальні відступи зліва — 📞 максимально біля лівого краю комірки */
  const sendPhoneButton = (
    <button
      type="button"
      className="inline-flex h-6 min-w-[1.25rem] shrink-0 items-center justify-center rounded-md p-0 pl-0 pr-0.5 text-base leading-none hover:bg-black/5"
      title="Надіслати телефон клієнта в Telegram адміністратора"
      aria-label="Надіслати телефон клієнта в Telegram адміністратора"
      onClick={(e) => {
        e.stopPropagation();
        sendPhoneToTelegram();
      }}
    >
      <span className="leading-none" aria-hidden>
        📞
      </span>
    </button>
  );

  const openReminderButton = (
    <button
      type="button"
      className="inline-flex h-6 min-w-[1.25rem] shrink-0 items-center justify-center rounded-md p-0 px-0.5 text-[13px] leading-none hover:bg-black/5"
      title="Відкрити нагадування передзвону"
      aria-label="Відкрити нагадування передзвону"
      onClick={open}
    >
      <span aria-hidden>💬</span>
    </button>
  );

  /** З датою: 📞 зліва; дедлайн + 💬; дата створення запису — під дедлайном (не під 📞). */
  const dateWithDeadlineLayout = (
    <div className="inline-flex w-full min-w-0 max-w-full items-start justify-start gap-0.5 pl-0 pr-0">
      {sendPhoneButton}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <button
          type="button"
          className="p-0 inline-flex max-w-full min-w-0 items-center justify-start gap-0.5"
          title="Відкрити нагадування передзвону"
          onClick={open}
        >
          <span className={pillClassName}>
            <span className={labelClassName}>{dateLabel}</span>
          </span>
          {commentIconSlot}
        </button>
        {creationDateUnderDeadline}
      </div>
    </div>
  );

  if (day && dateLabel) {
    return (
      <div
        className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-0.5 pl-0 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {dateWithDeadlineLayout}
      </div>
    );
  }

  return (
    <div
      className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-0.5 pl-0 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full min-w-0 max-w-full flex-row justify-start">
        <div className="flex w-full min-w-0 justify-start">
          <WithCornerRedDot show={showActivityDot} title={dotTitle} dotClassName={dotClassName}>
            <div className="inline-flex items-center justify-start gap-0.5 pl-0">
              {sendPhoneButton}
              {openReminderButton}
            </div>
          </WithCornerRedDot>
        </div>
      </div>
      {creationDateUnderDeadline}
    </div>
  );
}
