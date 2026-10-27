"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Slot = { from: string; to: string };
type Staff = { id: number; name: string; positionTitle: string; avatarUrl: string | null };

const MONTHS = ["СІЧ", "ЛЮТ", "БЕР", "КВІТ", "ТРАВ", "ЧЕРВ", "ЛИП", "СЕРП", "ВЕР", "ЖОВТ", "ЛИСТ", "ГРУД"];
const WEEKDAYS = ["НД", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const PRESETS: Array<[string, string]> = [
  ["09:00", "18:00"],
  ["10:00", "19:00"],
  ["10:00", "20:00"],
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function kyivTodayMonth() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "01";
  return `${get("year")}-${get("month")}`;
}

function kyivToday() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function monthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
}

function daysOfMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days: string[] = [];
  for (let d = 1; d <= last; d++) days.push(`${key}-${pad(d)}`);
  return days;
}

function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function dayNumber(ymd: string) {
  return Number(ymd.slice(8, 10));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function shortName(name: string) {
  const first = name.trim().split(/\s+/)[0] || name;
  return first.length > 8 ? `${first.slice(0, 7)}…` : first;
}

function formatDayTitle(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export default function JournalSchedulePage() {
  const today = kyivToday();
  const [month, setMonth] = useState(kyivTodayMonth);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [slots, setSlots] = useState<Record<string, Slot[]>>({});
  const [visibleIds, setVisibleIds] = useState<number[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<number[]>([]);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("20:00");
  const [breakOn, setBreakOn] = useState(false);
  const [breakFrom, setBreakFrom] = useState("14:00");
  const [breakTo, setBreakTo] = useState("15:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const shown = visibleIds ? staff.filter((row) => visibleIds.includes(row.id)) : staff;
  const months = [-2, -1, 0, 1, 2].map((delta) => shiftMonth(month, delta));

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/journal/schedule?month=${key}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка графіка");
      setStaff(json.staff || []);
      setSlots(json.slots || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка графіка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  function openEdit(day: string, staffId?: number) {
    setSelectedDay(day);
    const current = staffId ? slots[`${staffId}|${day}`] || [] : [];
    setEditStaff(staffId ? [staffId] : []);
    setFrom(current[0]?.from || "10:00");
    setTo(current.length > 1 ? current[current.length - 1].to : current[0]?.to || "20:00");
    if (current.length > 1) {
      setBreakOn(true);
      setBreakFrom(current[0].to);
      setBreakTo(current[1].from);
    } else {
      setBreakOn(false);
    }
    setEditOpen(true);
  }

  async function save(off = false) {
    if (!selectedDay || editStaff.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/schedule", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffIds: editStaff,
          dates: [selectedDay],
          from,
          to,
          breakFrom: breakOn ? breakFrom : "",
          breakTo: breakOn ? breakTo : "",
          off,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося зберегти");
      setEditOpen(false);
      await load(month);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100dvh-3.75rem)] lg:min-h-screen bg-[#f7f8fa]">
      <header className="sticky top-0 z-20 bg-white border-b px-3 h-12 flex items-center gap-2">
        <h1 className="text-[17px] font-semibold tracking-tight flex items-center gap-1.5">
          Графік роботи
          <span className="text-amber-400 text-base" aria-hidden>
            ▦
          </span>
        </h1>
        <button
          type="button"
          className="ml-auto h-8 px-3 rounded-full border border-gray-200 text-[13px] text-gray-600"
          onClick={() => setFilterOpen(true)}
        >
          {visibleIds ? `Обрано ${visibleIds.length}` : "Усі"}
        </button>
      </header>

      {error ? <div className="mx-3 mt-2 alert alert-error text-sm py-2">{error}</div> : null}
      {selectedDay ? (
        <button
          type="button"
          className="fixed z-30 right-3 top-14 inline-flex items-center gap-1 rounded-full bg-[#7c3aed] text-white text-[12px] font-medium px-2.5 h-7 shadow-sm"
          onClick={() => setSelectedDay(null)}
        >
          Вибрано 1 день
          <span aria-hidden>×</span>
        </button>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="min-w-max">
          <div className="sticky top-0 z-10 flex bg-white border-b">
            <div className="sticky left-0 z-20 w-[4.6rem] shrink-0 bg-white" />
            {days.map((day) => {
              const selected = day === selectedDay;
              return (
                <button
                  key={day}
                  type="button"
                  className={`w-[4.4rem] shrink-0 py-1.5 text-center border-l border-gray-100 ${
                    selected ? "bg-[#f3e8ff]" : day === today ? "bg-amber-50" : ""
                  }`}
                  onClick={() => setSelectedDay((prev) => (prev === day ? null : day))}
                >
                  <div className="text-[15px] font-medium leading-none tabular-nums">{dayNumber(day)}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{weekdayOf(day)}</div>
                </button>
              );
            })}
          </div>

          {loading && staff.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500">Завантаження…</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500">Немає майстрів у графіку</p>
          ) : (
            shown.map((person) => (
              <div key={person.id} className="flex border-b border-gray-100 bg-white">
                <div className="sticky left-0 z-10 w-[4.6rem] shrink-0 bg-white px-1 py-2 flex flex-col items-center gap-1 border-r border-gray-50">
                  <StaffFace name={person.name} src={person.avatarUrl} />
                  <span className="text-[10px] leading-none text-gray-700 text-center truncate w-full">
                    {shortName(person.name)}
                  </span>
                </div>
                {days.map((day) => {
                  const cell = slots[`${person.id}|${day}`] || [];
                  const selected = day === selectedDay;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`w-[4.4rem] shrink-0 min-h-[4.2rem] border-l border-gray-100 px-0.5 flex items-center justify-center ${
                        selected ? "bg-[#f6f0ff]" : "bg-[#f7f8fb]"
                      }`}
                      onClick={() => openEdit(day, person.id)}
                    >
                      {cell.length > 0 ? (
                        <span className="text-[10px] leading-tight text-gray-700 tabular-nums whitespace-pre-line">
                          {cell.map((slot) => `${slot.from}-${slot.to}`).join("\n")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 bg-[#f7f8fa] px-3 pt-2 pb-2 space-y-2">
        <button
          type="button"
          disabled={!selectedDay}
          className={`w-full h-12 rounded-full text-[16px] font-semibold ${
            selectedDay ? "bg-[#f5c400] text-gray-900" : "bg-[#f3e7a1] text-[#c4b56a]"
          }`}
          onClick={() => selectedDay && openEdit(selectedDay)}
        >
          Редагувати розклад
        </button>
        <div className="h-12 rounded-full bg-[#2a2e33] text-white flex items-stretch overflow-hidden">
          {months.map((key) => {
            const [year, mon] = key.split("-").map(Number);
            const active = key === month;
            return (
              <button
                key={key}
                type="button"
                className={`flex-1 text-[11px] font-semibold tracking-wide ${
                  active ? "bg-[#f5c400] text-gray-900" : ""
                }`}
                onClick={() => {
                  setMonth(key);
                  setSelectedDay(null);
                }}
              >
                <span className="block leading-none">{MONTHS[mon - 1]}</span>
                {active ? <span className="block text-[10px] font-medium mt-0.5">{year}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {filterOpen ? (
        <Sheet title="Майстри" onClose={() => setFilterOpen(false)}>
          <button
            type="button"
            className="w-full text-left px-1 py-2 text-sm font-medium"
            onClick={() => {
              setVisibleIds(null);
              setFilterOpen(false);
            }}
          >
            Усі
          </button>
          {staff.map((person) => {
            const on = !visibleIds || visibleIds.includes(person.id);
            return (
              <label key={person.id} className="flex items-center gap-2 py-1.5">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={on}
                  onChange={() => {
                    const base = visibleIds || staff.map((row) => row.id);
                    const next = on ? base.filter((id) => id !== person.id) : [...base, person.id];
                    setVisibleIds(next.length === staff.length ? null : next);
                  }}
                />
                <span className="text-sm">{person.name}</span>
              </label>
            );
          })}
        </Sheet>
      ) : null}

      {editOpen && selectedDay ? (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <header className="h-12 px-3 flex items-center gap-2 border-b">
            <button type="button" className="text-2xl leading-none px-1" onClick={() => setEditOpen(false)} aria-label="Назад">
              ‹
            </button>
            <h2 className="font-semibold">Редагування графіка на день</h2>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <p className="text-lg font-semibold">{formatDayTitle(selectedDay)}</p>
            <p className="text-sm font-medium">Співробітники</p>
            <div className="space-y-1">
              {staff.map((person) => {
                const on = editStaff.includes(person.id);
                return (
                  <label key={person.id} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={on}
                      onChange={() =>
                        setEditStaff((prev) => (on ? prev.filter((id) => id !== person.id) : [...prev, person.id]))
                      }
                    />
                    <StaffFace name={person.name} src={person.avatarUrl} />
                    <span className="text-sm">{person.name}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {PRESETS.map(([start, end]) => {
                const active = from === start && to === end && !breakOn;
                return (
                  <button
                    key={start + end}
                    type="button"
                    className={`shrink-0 h-9 px-3 rounded-full border text-sm ${
                      active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200"
                    }`}
                    onClick={() => {
                      setFrom(start);
                      setTo(end);
                      setBreakOn(false);
                    }}
                  >
                    з {start} до {end}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">Робочий час</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                з
                <input className="input input-bordered w-full mt-1" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-sm">
                до
                <input className="input input-bordered w-full mt-1" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="w-full h-11 rounded-full bg-gray-100 text-amber-600 font-medium"
              onClick={() => setBreakOn((v) => !v)}
            >
              {breakOn ? "Прибрати перерву" : "+ Додати перерву"}
            </button>
            {breakOn ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  перерва з
                  <input className="input input-bordered w-full mt-1" type="time" value={breakFrom} onChange={(e) => setBreakFrom(e.target.value)} />
                </label>
                <label className="text-sm">
                  до
                  <input className="input input-bordered w-full mt-1" type="time" value={breakTo} onChange={(e) => setBreakTo(e.target.value)} />
                </label>
              </div>
            ) : null}
          </div>
          <div className="shrink-0 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
            <button
              type="button"
              className="w-full h-12 rounded-full bg-[#f5c400] text-gray-900 font-semibold disabled:bg-[#f3e7a1] disabled:text-[#c4b56a]"
              disabled={saving || editStaff.length === 0 || from >= to}
              onClick={() => void save(false)}
            >
              {saving ? "Збереження…" : "Зберегти"}
            </button>
            <button
              type="button"
              className="w-full h-10 text-sm text-red-600 disabled:text-gray-300"
              disabled={saving || editStaff.length === 0}
              onClick={() => void save(true)}
            >
              Зробити вихідним
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StaffFace({ name, src }: { name: string; src: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center text-[10px] font-semibold text-gray-500 shrink-0">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[80vh] overflow-y-auto bg-white rounded-t-3xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
        <p className="font-semibold mb-2">{title}</p>
        {children}
      </div>
    </div>
  );
}
