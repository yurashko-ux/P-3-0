"use client";

import { useEffect, useState } from "react";
import {
  formatJournalBoldDate,
  kyivTodayYmd,
  shiftYmd,
  useJournalDay,
} from "./JournalDayContext";

type FxHeader = {
  usdWorking: number;
  eurWorking: number;
} | null;

function formatWorking(n: number): string {
  const v = Number(n);
  if (!(Number.isFinite(v) && v > 0)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(0);
}

export function JournalTopToolbar() {
  const { day, setDay, viewMode, setViewMode } = useJournalDay();
  const [fx, setFx] = useState<FxHeader>(null);

  useEffect(() => {
    let cancelled = false;
    setFx(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/journal/fx-rates?day=${encodeURIComponent(day)}`,
          { credentials: "include", cache: "no-store" },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (
          res.ok &&
          json?.ok &&
          Number(json.usdWorking) > 0 &&
          Number(json.eurWorking) > 0
        ) {
          setFx({
            usdWorking: Number(json.usdWorking),
            eurWorking: Number(json.eurWorking),
          });
        } else {
          setFx(null);
        }
      } catch {
        if (!cancelled) setFx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [day]);

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

      <h1 className="text-lg font-bold capitalize tracking-tight ml-1 flex items-baseline gap-2 flex-wrap">
        <span>{formatJournalBoldDate(day)}</span>
        <span
          className="text-sm font-semibold normal-case tracking-normal text-gray-600 tabular-nums"
          title="Робочий курс дня (Monobank sell → ceil+1)"
        >
          {fx
            ? `$${formatWorking(fx.usdWorking)} · €${formatWorking(fx.eurWorking)}`
            : "—"}
        </span>
      </h1>

      <div className="join ml-auto">
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
