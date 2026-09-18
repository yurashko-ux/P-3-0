"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { kyivTodayYmd, useJournalDay } from "./JournalDayContext";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function ymdFromParts(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function monthLabel(y: number, m: number) {
  const dt = new Date(Date.UTC(y, m - 1, 1, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    month: "long",
    year: "numeric",
  }).format(dt);
}

function mondayBasedWeekday(jsDay: number) {
  return (jsDay + 6) % 7;
}

export function JournalSidebarCalendar() {
  const { day, setDay } = useJournalDay();
  const pathname = usePathname();
  const router = useRouter();
  const selected = parseYmd(day);
  const today = kyivTodayYmd();
  const [cursor, setCursor] = useState({ y: selected.y, m: selected.m });

  function selectDay(ymd: string) {
    setDay(ymd);
    if (pathname !== "/admin/journal") {
      router.push("/admin/journal");
    }
  }

  useEffect(() => {
    setCursor({ y: selected.y, m: selected.m });
  }, [selected.y, selected.m]);

  const cells = useMemo(() => {
    const { y, m } = cursor;
    const first = new Date(Date.UTC(y, m - 1, 1, 12));
    const startPad = mondayBasedWeekday(first.getUTCDay());
    const daysInMonth = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
    const out: Array<{ ymd: string; label: number } | null> = [];
    for (let i = 0; i < startPad; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ ymd: ymdFromParts(y, m, d), label: d });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const dt = new Date(Date.UTC(c.y, c.m - 1 + delta, 1, 12));
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 };
    });
  }

  return (
    <div className="rounded-xl border bg-white px-2 py-2">
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs min-h-0 h-7 w-7 px-0"
          onClick={() => shiftMonth(-1)}
          aria-label="Попередній місяць"
        >
          ‹
        </button>
        <div className="flex-1 text-center text-xs font-semibold capitalize truncate">
          {monthLabel(cursor.y, cursor.m)}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs min-h-0 h-7 w-7 px-0"
          onClick={() => shiftMonth(1)}
          aria-label="Наступний місяць"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-center text-gray-500 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`e-${idx}`} className="h-7" />;
          const isSelected = cell.ymd === day;
          const isToday = cell.ymd === today;
          return (
            <button
              key={cell.ymd}
              type="button"
              className={[
                "h-7 rounded-full text-xs leading-none",
                isSelected
                  ? "bg-neutral text-neutral-content font-semibold"
                  : isToday
                    ? "border border-neutral/40 font-medium hover:bg-gray-100"
                    : "hover:bg-gray-100",
              ].join(" ")}
              onClick={() => selectDay(cell.ymd)}
            >
              {cell.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
