"use client";

// Денна сітка журналу: блоки за тривалістю, колір за статусом, без накладання тексту.

import { useState } from "react";
import type { JournalMaster } from "./JournalAppointmentForm";
import { attendanceBlockStyle, normalizeAttendance } from "@/lib/journal/attendance";

function masterAvatarUrl(instagram?: string | null) {
  const u = (instagram || "").replace(/^@/, "").trim();
  if (!u) return null;
  return `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(u)}`;
}

function MasterColumnAvatar({ name, instagramUsername }: { name: string; instagramUsername?: string | null }) {
  const [broken, setBroken] = useState(false);
  const src = masterAvatarUrl(instagramUsername);
  const letters = initials(name);
  return (
    <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold flex items-center justify-center shrink-0 overflow-hidden">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        letters
      )}
    </div>
  );
}

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
  altegioRecordId?: number | null;
  staffName: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  lines: Array<{ serviceId: string | null; title: string }>;
  checkout?: {
    status: string;
    paidAmount: number;
    totalServices?: number;
  } | null;
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

function staffKey(row: JournalGridAppointment) {
  return row.altegioStaffId != null && row.altegioStaffId > 0 ? String(row.altegioStaffId) : row.masterId || "—";
}

type LayoutAppt = {
  row: JournalGridAppointment;
  startMin: number;
  endMin: number;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
};

/** Розкладає перекриття в «смуги», щоб блоки не наїжджали текстом. */
function layoutColumn(rows: JournalGridAppointment[]): LayoutAppt[] {
  const items = rows
    .map((row) => {
      const startHm = kyivHm(row.datetime);
      const durationMin = Math.max(15, Math.round((row.seanceLength || 3600) / 60));
      const startMin = hmToMinutes(startHm);
      return {
        row,
        startMin,
        endMin: startMin + durationMin,
        top: (startMin - START_HOUR * 60) * PX_PER_MIN,
        height: Math.max(28, durationMin * PX_PER_MIN - 3),
        lane: 0,
        laneCount: 1,
      };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  for (let i = 0; i < items.length; i++) {
    const overlaps: LayoutAppt[] = [];
    for (let j = 0; j < i; j++) {
      if (items[j].startMin < items[i].endMin && items[i].startMin < items[j].endMin) {
        overlaps.push(items[j]);
      }
    }
    const used = new Set(overlaps.map((o) => o.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    items[i].lane = lane;
  }

  for (let i = 0; i < items.length; i++) {
    let maxLane = items[i].lane;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (items[j].startMin < items[i].endMin && items[i].startMin < items[j].endMin) {
        maxLane = Math.max(maxLane, items[j].lane);
      }
    }
    items[i].laneCount = maxLane + 1;
  }

  return items;
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
              <MasterColumnAvatar name={m.name} instagramUsername={m.instagramUsername} />
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
            const laid = layoutColumn(rows);
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
                {laid.map((item) => {
                  const { row, top, height, lane, laneCount, startMin, endMin } = item;
                  const startHm = minutesToHm(startMin);
                  const endHm = minutesToHm(endMin);
                  const titles = row.lines.map((l) => l.title).filter(Boolean);
                  const phone = phoneOf(row);
                  const att = normalizeAttendance(row.attendance);
                  const colors = attendanceBlockStyle(att);
                  const gap = 2;
                  const widthPct = 100 / laneCount;
                  const leftPct = lane * widthPct;
                  // Скільки рядків тексту вміщується (~14px на рядок)
                  const maxLines = Math.max(1, Math.floor((height - 4) / 14));
                  const linesToShow: string[] = [`${startHm}–${endHm}`];
                  if (maxLines >= 2 && titles[0]) linesToShow.push(titles[0]);
                  if (maxLines >= 3) linesToShow.push(clientLabelOf(row));
                  if (maxLines >= 4 && phone) linesToShow.push(phone);
                  if (maxLines >= 5 && row.checkout?.status === "synced" && Number(row.checkout.paidAmount) > 0) {
                    linesToShow.push(`оплачено ${Number(row.checkout.paidAmount).toLocaleString("uk-UA")} грн`);
                  }

                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`absolute z-10 overflow-hidden rounded-md border text-left px-1.5 py-0.5 leading-snug shadow-sm ${
                        row.status === "sync_error" ? "ring-2 ring-red-500" : ""
                      }`}
                      style={{
                        top: Math.max(0, top),
                        height,
                        left: `calc(${leftPct}% + ${gap}px)`,
                        width: `calc(${widthPct}% - ${gap * 2}px)`,
                        backgroundColor: colors.bg,
                        borderColor: colors.border,
                        color: colors.text,
                      }}
                      title={row.syncError || [...titles, clientLabelOf(row), phone].filter(Boolean).join(" · ")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointment(row);
                      }}
                    >
                      {linesToShow.map((line, i) => (
                        <div
                          key={`${row.id}-l-${i}`}
                          className={`truncate ${i === 0 ? "text-[10px] font-semibold tabular-nums" : "text-[11px] font-medium"}`}
                        >
                          {line}
                        </div>
                      ))}
                      {row.status === "sync_error" ? (
                        <div className="text-[10px] text-red-800 font-semibold">помилка sync</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <TimeGutter />
          {loading && <div className="absolute inset-0 bg-white/40 pointer-events-none" />}
        </div>
      </div>
    </div>
  );
}
