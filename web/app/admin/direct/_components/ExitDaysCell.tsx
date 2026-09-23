"use client";

// Колонка «Днів (вихід)»: pill + дата під ним; клік → історія неактивності.

import { formatDateDDMMYY } from "@/app/admin/direct/_components/direct-client-table-formatters";

export type ExitDaysCellProps = {
  exitDays: number | null | undefined;
  inactiveSinceKyivDay?: string | null;
  restoredAtKyivDay?: string | null;
  status?: "active" | "inactive" | "restored" | string | null;
  onOpenHistory?: () => void;
  align?: "left" | "right";
};

function pillClass(days: number | null, restored: boolean): string {
  if (restored || days === 0) return "bg-emerald-200 text-emerald-900";
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
}: ExitDaysCellProps) {
  const restored = status === "restored" || exitDays === 0;
  const hasDays = typeof exitDays === "number" && Number.isFinite(exitDays);
  const days = hasDays ? exitDays : null;
  const subDate = restored
    ? restoredAtKyivDay || null
    : inactiveSinceKyivDay || null;
  const title = restored
    ? `Відновлений${restoredAtKyivDay ? ` з ${formatDateDDMMYY(restoredAtKyivDay)}` : ""}`
    : hasDays
      ? `Днів: ${days}${inactiveSinceKyivDay ? `\nВихід на неактивність: ${formatDateDDMMYY(inactiveSinceKyivDay)}` : ""}`
      : "Днів: —";

  const content = (
    <span className={`inline-flex flex-col ${align === "right" ? "items-end" : "items-start"} leading-none gap-0.5`}>
      <span
        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums text-[12px] font-normal leading-none ${pillClass(
          days,
          restored
        )}`}
      >
        {hasDays ? days : "—"}
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
        className="btn btn-ghost btn-xs h-auto min-h-0 px-0 py-0 hover:bg-transparent"
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

  return (
    <span title={title}>{content}</span>
  );
}
