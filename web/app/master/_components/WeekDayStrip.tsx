"use client";

import { dayOfMonth, kyivTodayYmd, kyivWeekDays, weekdayShortLabel } from "../_lib/kyiv-day";

export function WeekDayStrip({
  anchorDay,
  selectedDay,
  dayCounts,
  onSelectDay,
  onShiftWeek,
}: {
  /** День, за яким рахується поточний тиждень (Пн..Нд). */
  anchorDay: string;
  selectedDay: string;
  dayCounts: Record<string, number>;
  onSelectDay: (day: string) => void;
  onShiftWeek: (deltaDays: 7 | -7) => void;
}) {
  const days = kyivWeekDays(anchorDay);
  const today = kyivTodayYmd();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onShiftWeek(-7)}
        className="shrink-0 rounded-full px-2 py-1 text-sm text-slate-500 active:scale-95"
        aria-label="Попередній тиждень"
      >
        ←
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d) => {
          const isSelected = d === selectedDay;
          const isToday = d === today;
          const count = dayCounts[d] || 0;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 transition ${
                isSelected ? "bg-slate-700 text-white" : "text-gray-600 active:bg-slate-100"
              }`}
            >
              <span className="text-[10px] font-medium uppercase opacity-80">{weekdayShortLabel(d)}</span>
              <span className={`text-sm font-semibold tabular-nums ${isToday && !isSelected ? "text-slate-900" : ""}`}>
                {dayOfMonth(d)}
              </span>
              <span
                className={`h-1 w-1 rounded-full ${
                  count > 0 ? (isSelected ? "bg-white" : "bg-slate-500") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onShiftWeek(7)}
        className="shrink-0 rounded-full px-2 py-1 text-sm text-slate-500 active:scale-95"
        aria-label="Наступний тиждень"
      >
        →
      </button>
    </div>
  );
}
