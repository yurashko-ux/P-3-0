"use client";

import {
  formatJournalBoldDate,
  kyivTodayYmd,
  shiftYmd,
  useJournalDay,
} from "./JournalDayContext";

export function JournalTopToolbar() {
  const { day, setDay, viewMode, setViewMode } = useJournalDay();

  return (
    <header className="sticky top-0 z-10 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2 min-h-11">
      <button
        type="button"
        className="btn btn-sm btn-ghost min-h-0 h-8"
        onClick={() => setDay(kyivTodayYmd())}
      >
        Сьогодні
      </button>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="btn btn-sm btn-ghost min-h-0 h-8 w-8 px-0"
          onClick={() => setDay(shiftYmd(day, -1))}
          aria-label="Попередній день"
        >
          ‹
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost min-h-0 h-8 w-8 px-0"
          onClick={() => setDay(shiftYmd(day, 1))}
          aria-label="Наступний день"
        >
          ›
        </button>
      </div>

      <h1 className="text-lg font-bold capitalize tracking-tight ml-1 mr-auto">
        {formatJournalBoldDate(day)}
      </h1>

      <div className="join">
        <button
          type="button"
          className={`btn btn-sm join-item min-h-0 h-8 ${viewMode === "day" ? "btn-neutral" : "btn-ghost"}`}
          onClick={() => setViewMode("day")}
        >
          День
        </button>
        <button
          type="button"
          className={`btn btn-sm join-item min-h-0 h-8 ${viewMode === "week" ? "btn-neutral" : "btn-ghost"}`}
          onClick={() => setViewMode("week")}
        >
          Тиждень
        </button>
      </div>
    </header>
  );
}
