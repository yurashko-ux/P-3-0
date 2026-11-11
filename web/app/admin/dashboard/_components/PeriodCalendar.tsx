// Календар дашборду: розгорнутий місяць, вибір періоду двома кліками (початкова і кінцева дата) та кнопки періодів.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  buildPresets,
  daysBetween,
  formatDayShort,
  MAX_PERIOD_DAYS,
  monthRange,
  MONTH_TITLES,
  weekStart,
} from "@/lib/dashboard/period";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type Props = {
  today: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
};

export function PeriodCalendar({ today, from, to, onChange }: Props) {
  // Місяць, який зараз показано (перший день).
  const [viewMonth, setViewMonth] = useState(() => monthRange(from).from);
  // Перший клік запам'ятовує початок; другий — закриває період. Запит до сервера йде лише після другого.
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  useEffect(() => {
    setViewMonth(monthRange(from).from);
    setPendingStart(null);
  }, [from, to]);

  const presets = useMemo(() => buildPresets(today), [today]);
  const view = monthRange(viewMonth);
  const days = useMemo(() => {
    const start = weekStart(view.from);
    const total = Math.ceil(daysBetween(start, view.to) / 7) * 7;
    return Array.from({ length: total }, (_, i) => addDays(start, i));
  }, [view.from, view.to]);

  const pickDay = (day: string) => {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    const start = day < pendingStart ? day : pendingStart;
    const end = day < pendingStart ? pendingStart : day;
    setPendingStart(null);
    onChange(start, end);
  };

  const rangeFrom = pendingStart ?? from;
  const rangeTo = pendingStart ?? to;
  const tooLong = pendingStart
    ? (day: string) => daysBetween(day < pendingStart ? day : pendingStart, day < pendingStart ? pendingStart : day) > MAX_PERIOD_DAYS
    : () => false;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:max-w-sm lg:max-w-none">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setViewMonth(monthRange(viewMonth, -1).from)}
            aria-label="Попередній місяць"
          >
            ‹
          </button>
          <div className="text-sm font-semibold text-slate-900">
            {MONTH_TITLES[view.month - 1]} {view.year}
          </div>
          <button
            type="button"
            className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setViewMonth(monthRange(viewMonth, 1).from)}
            aria-label="Наступний місяць"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-slate-400">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const outside = day < view.from || day > view.to;
            const inRange = day >= rangeFrom && day <= rangeTo;
            const isEdge = day === rangeFrom || day === rangeTo;
            const disabled = tooLong(day);
            return (
              <button
                key={day}
                type="button"
                disabled={disabled}
                onClick={() => pickDay(day)}
                aria-pressed={inRange}
                aria-label={formatDayShort(day)}
                className={[
                  "relative h-9 text-sm tabular-nums transition-colors",
                  isEdge
                    ? "rounded-lg bg-slate-900 font-semibold text-white"
                    : inRange
                      ? "bg-slate-100 text-slate-900"
                      : outside
                        ? "rounded-lg text-slate-300 hover:bg-slate-50"
                        : "rounded-lg text-slate-700 hover:bg-slate-100",
                  disabled ? "cursor-not-allowed opacity-30" : "",
                ].join(" ")}
              >
                {Number(day.slice(8))}
                {day === today && (
                  <span
                    className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isEdge ? "bg-white" : "bg-blue-600"}`}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-400">Початок</div>
            <div className="font-medium tabular-nums text-slate-900">{formatDayShort(rangeFrom)}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-400">Кінець</div>
            <div className="font-medium tabular-nums text-slate-900">
              {pendingStart ? "оберіть дату" : formatDayShort(rangeTo)}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-400">
          {pendingStart
            ? "Тепер натисніть кінцеву дату. Той самий день ще раз — один день."
            : "Натисніть початкову дату, потім кінцеву."}
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-2 lg:overflow-visible lg:pb-0">
        {presets.map((preset) => {
          const active = !pendingStart && preset.from === from && preset.to === to;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange(preset.from, preset.to)}
              className={[
                "shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : preset.future
                    ? "border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
              title={preset.future ? "Заплановані записи на цей місяць" : undefined}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
