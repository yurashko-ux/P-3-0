"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WORKLOAD_COLORS, type DayWorkload } from "@/lib/journal/day-workload";
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

export function JournalSidebarCalendar({
  touch = false,
  onPicked,
}: {
  touch?: boolean;
  onPicked?: () => void;
} = {}) {
  const { day, setDay } = useJournalDay();
  const pathname = usePathname();
  const router = useRouter();
  const selected = parseYmd(day);
  const today = kyivTodayYmd();
  const [cursor, setCursor] = useState({ y: selected.y, m: selected.m });
  const [workload, setWorkload] = useState<Record<string, DayWorkload>>({});

  useEffect(() => {
    const month = `${cursor.y}-${pad(cursor.m)}`;
    const ac = new AbortController();
    setWorkload({});
    fetch(`/api/admin/journal/workload?month=${month}`, { credentials: "include", signal: ac.signal })
      .then((res) => res.json())
      .then((json) => {
        if (ac.signal.aborted || !json?.ok || !json.days) return;
        setWorkload(json.days);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn("[journal/calendar] Не вдалось прочитати завантаженість", err);
      });
    return () => ac.abort();
  }, [cursor.y, cursor.m]);

  function selectDay(ymd: string) {
    setDay(ymd);
    onPicked?.();
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
    <div className={`rounded-xl border bg-white ${touch ? "px-3 py-3" : "px-2 py-2"}`}>
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs min-h-0 h-7 w-7 px-0"
          onClick={() => shiftMonth(-1)}
          aria-label="Попередній місяць"
        >
          ‹
        </button>
        <div className={`flex-1 text-center font-semibold capitalize truncate ${touch ? "text-base" : "text-xs"}`}>
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
      <div className={`grid grid-cols-7 text-center text-gray-500 mb-1 ${touch ? "gap-1 text-xs" : "gap-0.5 text-[10px]"}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-7 ${touch ? "gap-1" : "gap-0.5"}`}>
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`e-${idx}`} className={touch ? "h-11" : "h-7"} />;
          const isSelected = cell.ymd === day;
          const isToday = cell.ymd === today;
          const load = workload[cell.ymd];
          const ring = load
            ? `conic-gradient(from -90deg, ${WORKLOAD_COLORS[load.color]} ${load.percent}%, #e4e7ee 0)`
            : undefined;
          return (
            <button
              key={cell.ymd}
              type="button"
              title={load ? `Завантаженість ${load.percent}%` : undefined}
              className={[
                "mx-auto flex items-center justify-center rounded-full leading-none",
                touch ? "h-11 w-11 text-sm" : "h-7 w-7 text-xs",
                ring ? "p-[2px]" : "",
                !ring && isSelected
                  ? "bg-neutral text-neutral-content font-semibold"
                  : !ring && isToday
                    ? "border border-neutral/40 font-medium hover:bg-gray-100"
                    : !ring
                      ? "hover:bg-gray-100"
                      : "",
              ].join(" ")}
              style={ring ? { background: ring } : undefined}
              onClick={() => selectDay(cell.ymd)}
            >
              {ring ? (
                <span
                  className={[
                    "flex h-full w-full items-center justify-center rounded-full",
                    isSelected
                      ? "bg-neutral text-neutral-content font-semibold"
                      : "bg-white text-gray-900",
                    isToday && !isSelected ? "font-medium" : "",
                  ].join(" ")}
                >
                  {cell.label}
                </span>
              ) : (
                cell.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
