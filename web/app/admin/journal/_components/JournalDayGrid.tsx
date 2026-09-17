"use client";

// Денна сітка журналу в стилі Altegio: 30-хв лінії, блоки за тривалістю, кольори консультація/послуга.

import type { JournalMaster } from "./JournalAppointmentForm";

export type JournalGridAppointment = {
  id: string;
  datetime: string;
  seanceLength: number;
  attendance: number | null;
  comment?: string | null;
  status: string;
  syncError: string | null;
  masterId: string | null;
  altegioStaffId: number | null;
  staffName: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  lines: Array<{ serviceId: string | null; title: string }>;
  directClient: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string;
    phone?: string | null;
  } | null;
};

const START_HOUR = 9;
const END_HOUR = 20;
const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;
const GRID_MINUTES = (END_HOUR - START_HOUR) * 60;
const BODY_HEIGHT = GRID_MINUTES * PX_PER_MIN + 10;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function kyivHm(iso: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("hour")}:${get("minute")}`;
}

function hmToMinutes(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHm(total: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

function addMinutesHm(hm: string, minutes: number) {
  return minutesToHm(hmToMinutes(hm) + minutes);
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function clientLabelOf(row: JournalGridAppointment) {
  if (row.clientName) return row.clientName;
  const c = row.directClient;
  if (c) return [c.lastName, c.firstName].filter(Boolean).join(" ") || c.instagramUsername;
  return "Клієнт";
}

function phoneOf(row: JournalGridAppointment) {
  return row.clientPhone || row.directClient?.phone || "";
}

function blockTone(titles: string[], durationMin: number): "service" | "consult-long" | "consult-short" {
  const consult = titles.filter((t) => /консультаці/i.test(t));
  const paid = titles.filter((t) => !/консультаці/i.test(t));
  if (paid.length === 0 && consult.length > 0) {
    return durationMin <= 45 ? "consult-short" : "consult-long";
  }
  return "service";
}

const TONE_CLASS: Record<ReturnType<typeof blockTone>, string> = {
  service: "bg-[#7FE8D4] text-[#134e4a] border-[#5fd4c0]",
  "consult-long": "bg-[#F5C15A] text-[#5c3a00] border-[#e0a93a]",
  "consult-short": "bg-[#26C4A8] text-white border-[#1aa58d]",
};

function staffKey(row: JournalGridAppointment) {
  return row.altegioStaffId != null && row.altegioStaffId > 0 ? String(row.altegioStaffId) : row.masterId || "—";
}

function TimeGutter() {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  return (
    <div className="relative shrink-0 w-10 text-[11px] select-none" style={{ height: BODY_HEIGHT }}>
      {hours.map((hour) => (
        <div key={hour} className="absolute left-0 right-0" style={{ top: (hour - START_HOUR) * HOUR_PX }}>
          <span
            className={`block text-right pr-1.5 tabular-nums text-gray-500 leading-none ${
              hour === START_HOUR ? "" : hour === END_HOUR ? "-translate-y-full" : "-translate-y-1/2"
            }`}
          >
            {hour}
          </span>
          {hour < END_HOUR && (
            <span
              className="absolute right-1.5 tabular-nums text-gray-400 leading-none"
              style={{ top: HOUR_PX / 2, transform: "translateY(-50%)" }}
            >
              30
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function JournalDayGrid({
  day,
  masters,
  appointments,
  loading,
  onEmptySlot,
  onAppointment,
}: {
  day: string;
  masters: JournalMaster[];
  appointments: JournalGridAppointment[];
  loading?: boolean;
  onEmptySlot: (masterId: string, datetimeLocal: string) => void;
  onAppointment: (row: JournalGridAppointment) => void;
}) {
  const byStaff = new Map<string, JournalGridAppointment[]>();
  for (const row of appointments) {
    const key = staffKey(row);
    const list = byStaff.get(key) || [];
    list.push(row);
    byStaff.set(key, list);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex border-b border-gray-100">
          <div className="w-10 shrink-0" />
          {masters.map((m) => (
            <div key={m.id} className="flex-1 min-w-[180px] px-3 py-2.5 flex items-center gap-2 border-l border-gray-100">
              <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold flex items-center justify-center shrink-0">
                {initials(m.name)}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-tight truncate">{m.name}</div>
                <div className="text-[11px] text-gray-400 leading-tight">{m.positionTitle || "Майстер"}</div>
              </div>
            </div>
          ))}
          {masters.length === 0 && (
            <div className="flex-1 px-3 py-3 text-sm text-gray-500">Немає майстрів у штаті Altegio</div>
          )}
          <div className="w-10 shrink-0" />
        </div>

        <div className="flex relative">
          <TimeGutter />
          {masters.map((m) => {
            const rows = byStaff.get(String(m.altegioStaffId || m.id)) || [];
            return (
              <div
                key={m.id}
                className="relative flex-1 min-w-[180px] border-l border-gray-100 cursor-pointer"
                style={{ height: BODY_HEIGHT }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const rawMin = START_HOUR * 60 + y / PX_PER_MIN;
                  const snapped = Math.min(
                    (END_HOUR - 1) * 60 + 45,
                    Math.max(START_HOUR * 60, Math.round(rawMin / 15) * 15),
                  );
                  const hm = minutesToHm(snapped);
                  onEmptySlot(m.id, `${day}T${hm}`);
                }}
              >
                {Array.from({ length: (END_HOUR - START_HOUR) * 2 + 1 }, (_, i) => (
                  <div
                    key={i}
                    className={`absolute left-0 right-0 pointer-events-none ${i % 2 === 0 ? "border-t border-gray-200" : "border-t border-gray-100"}`}
                    style={{ top: i * (HOUR_PX / 2) }}
                  />
                ))}
                {rows.map((row) => {
                  const startHm = kyivHm(row.datetime);
                  const durationMin = Math.max(15, Math.round((row.seanceLength || 3600) / 60));
                  const endHm = addMinutesHm(startHm, durationMin);
                  const startMin = hmToMinutes(startHm);
                  const top = (startMin - START_HOUR * 60) * PX_PER_MIN;
                  const height = Math.max(22, durationMin * PX_PER_MIN - 2);
                  const titles = row.lines.map((l) => l.title).filter(Boolean);
                  const tone = blockTone(titles, durationMin);
                  const phone = phoneOf(row);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`absolute left-1 right-1 z-10 overflow-hidden rounded-md border text-left px-1.5 py-1 leading-tight ${TONE_CLASS[tone]} ${
                        row.status === "sync_error" ? "ring-1 ring-red-500" : ""
                      }`}
                      style={{ top: Math.max(0, top), height }}
                      title={row.syncError || titles.join(", ")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointment(row);
                      }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-[10px] font-medium tabular-nums opacity-90">
                          {startHm}—{endHm}
                        </span>
                        <span
                          className={`mt-0.5 w-3 h-3 rounded-full shrink-0 ${
                            row.attendance === 1 ? "bg-white/80 text-[#0f766e]" : "bg-white/40 text-current"
                          } flex items-center justify-center text-[8px] leading-none`}
                        >
                          {row.attendance === 1 ? "✓" : "i"}
                        </span>
                      </div>
                      {titles.map((title, i) => (
                        <div key={`${row.id}-svc-${i}`} className="text-[11px] font-medium truncate">
                          {title}
                        </div>
                      ))}
                      <div className="text-[11px] truncate">{clientLabelOf(row)}</div>
                      {phone ? <div className="text-[11px] truncate opacity-90">{phone}</div> : null}
                      {row.status === "sync_error" ? <div className="text-[10px] text-red-700">помилка синхронізації</div> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <TimeGutter />
          {loading && (
            <div className="absolute inset-0 bg-white/40 pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  );
}
