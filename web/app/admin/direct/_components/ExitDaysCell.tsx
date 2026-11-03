"use client";

// Колонка «Днів»: число днів + бейдж ✓ (повернувся) і дата під pill.

import { formatDateDDMMYY } from "@/app/admin/direct/_components/direct-client-table-formatters";

export type ExitDaysCellProps = {
  /** Актуальні дні з останнього візиту (як колонка «Днів») */
  exitDays: number | null | undefined;
  inactiveSinceKyivDay?: string | null;
  restoredAtKyivDay?: string | null;
  status?: "active" | "inactive" | "restored" | string | null;
  onOpenHistory?: () => void;
  align?: "left" | "right";
  /** Дата останнього візиту — для tooltip */
  lastVisitAt?: string | null;
};

function pillClass(days: number | null, restored: boolean, inactive: boolean): string {
  if (restored) return "bg-emerald-200 text-emerald-900";
  if (inactive) return "bg-red-200 text-red-900";
  if (days == null) return "bg-gray-200 text-gray-900";
  if (days <= 60) return "bg-gray-200 text-gray-900";
  if (days <= 90) return "bg-amber-200 text-amber-900";
  return "bg-red-200 text-red-900";
}

export function ExitDaysCell({
  exitDays,
  inactiveSinceKyivDay,
  restoredAtKyivDay,
  status,
  onOpenHistory,
  align = "right",
  lastVisitAt,
}: ExitDaysCellProps) {
  const restored = status === "restored";
  const inactive = status === "inactive";
  const hasDays = typeof exitDays === "number" && Number.isFinite(exitDays);
  const days = hasDays ? exitDays : null;
  const subDate = restored
    ? restoredAtKyivDay || null
    : inactive
      ? inactiveSinceKyivDay || null
      : null;

  let title = restored
    ? `Повернувся в активну базу (майбутній запис)${
        restoredAtKyivDay ? `\nДата відновлення: ${formatDateDDMMYY(restoredAtKyivDay)}` : ""
      }${inactiveSinceKyivDay ? `\nРаніше вихід на 101: ${formatDateDDMMYY(inactiveSinceKyivDay)}` : ""}`
    : inactive
      ? `Неактивна база${hasDays ? `\nДнів: ${days}` : ""}${
          inactiveSinceKyivDay ? `\nВихід на 101: ${formatDateDDMMYY(inactiveSinceKyivDay)}` : ""
        }`
      : hasDays
        ? `Днів з останнього візиту: ${days}`
        : "Днів: —";
  if (lastVisitAt && hasDays) {
    title += `\nДата останнього візиту: ${formatDateDDMMYY(lastVisitAt)}`;
  }

  const content = (
    <span
      className={`inline-flex flex-col ${align === "right" ? "items-end" : "items-start"} leading-none gap-0.5`}
    >
      <span className="relative inline-flex items-center">
        <span
          className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums text-[12px] font-normal leading-none ${pillClass(
            days,
            restored,
            inactive
          )}`}
        >
          {hasDays ? days : "—"}
        </span>
        {restored ? (
          <span
            className="absolute -right-1.5 -top-1.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm ring-1 ring-white"
            title="Повернувся"
            aria-hidden
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6.2 L5 8.7 L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}
      </span>
      {subDate ? (
        <span className="text-[9px] tabular-nums text-base-content/55 leading-none">
          {formatDateDDMMYY(subDate)}
        </span>
      ) : null}
    </span>
  );

  if (onOpenHistory) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs !h-auto !min-h-0 !px-0 !py-0 hover:bg-transparent"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onOpenHistory();
        }}
      >
        {content}
      </button>
    );
  }

  return <span title={title}>{content}</span>;
}
