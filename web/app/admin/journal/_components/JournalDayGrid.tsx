"use client";

// Денна сітка журналу: блоки за тривалістю, колір за статусом.
// Накладання як у Altegio — зсув + шар, без звуження колонки на N смуг.
// Верхня смуга: hover (затримка) / long-press / клік → попап перегляду.

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import type { JournalMaster } from "./JournalAppointmentForm";
import { attendanceBlockStyle, normalizeAttendance } from "@/lib/journal/attendance";
import { JournalAppointmentPeek, type PeekState } from "./JournalAppointmentPeek";
import { ClientNameWithLoyalty } from "@/app/admin/_components/ClientNameWithLoyalty";
import { kyivTodayYmd } from "./JournalDayContext";

function masterAvatarUrl(instagram?: string | null) {
  const u = (instagram || "").replace(/^@/, "").trim();
  if (!u) return null;
  return `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(u)}`;
}

function MasterColumnAvatar({
  name,
  instagramUsername,
  className,
}: {
  name: string;
  instagramUsername?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = masterAvatarUrl(instagramUsername);
  const letters = initials(name);
  return (
    <div
      className={`rounded-full bg-gray-100 text-gray-600 font-semibold flex items-center justify-center shrink-0 overflow-hidden ${
        className || "w-8 h-8 text-[11px]"
      }`}
    >
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
  lines: Array<{ serviceId: string | null; title: string; cost?: number | null }>;
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
    spent?: number | null;
    visits?: number | null;
    lastVisitAt?: string | Date | null;
    noShowCount?: number | null;
  } | null;
};

const START_HOUR = 9;
const END_HOUR = 20;
/** Висота години на планшеті й десктопі. */
const HOUR_PX = 88;
/** На телефоні година вища, щоб картка дихала як у Altegio. */
const PHONE_HOUR_PX = 132;
const PX_PER_MIN = HOUR_PX / 60;
function bodyHeight(hourPx: number) {
  return (END_HOUR - START_HOUR) * hourPx + 10;
}
const BODY_HEIGHT = bodyHeight(HOUR_PX);
const HOVER_DELAY_MS = 400;
const LONG_PRESS_MS = 500;
const OVERLAP_OFFSET_PX = 16;
/** Верхня зелена смуга з часом запису. */
const STRIP_PX = 22;
const PHONE_STRIP_PX = 30;
/** Мінімальна висота блоку запису (короткі сеанси все одно читабельні). */
const MIN_EVENT_PX = 46;

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

/** Накладання як у Altegio: колонка повної ширини, зсув вправо + шар зверху. */
function layoutColumn(rows: JournalGridAppointment[], pxPerMin = PX_PER_MIN): LayoutAppt[] {
  const items = rows
    .map((row) => {
      const startHm = kyivHm(row.datetime);
      const durationMin = Math.max(15, Math.round((row.seanceLength || 3600) / 60));
      const startMin = hmToMinutes(startHm);
      return {
        row,
        startMin,
        endMin: startMin + durationMin,
        top: (startMin - START_HOUR * 60) * pxPerMin,
        height: Math.max(MIN_EVENT_PX, durationMin * pxPerMin - 2),
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

function TimeGutter({ hourPx = HOUR_PX, full = false }: { hourPx?: number; full?: boolean }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const height = bodyHeight(hourPx);
  return (
    <div className={`relative shrink-0 select-none ${full ? "w-12 text-[11px]" : "w-10 text-[11px]"}`} style={{ height }}>
      {hours.map((hour) => (
        <div key={hour} className="absolute left-0 right-0" style={{ top: (hour - START_HOUR) * hourPx }}>
          <span
            className={`block text-right pr-1 tabular-nums text-gray-400 leading-none ${
              hour === START_HOUR ? "" : hour === END_HOUR ? "-translate-y-full" : "-translate-y-1/2"
            }`}
          >
            {full ? `${hour}:00` : hour}
          </span>
          {!full && hour < END_HOUR && (
            <span
              className="absolute right-1.5 tabular-nums text-gray-300 leading-none"
              style={{ top: hourPx / 2, transform: "translateY(-50%)" }}
            >
              30
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function kyivNowMinutes() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  return get("hour") * 60 + get("minute");
}

function stripMark(attendance: number) {
  if (attendance === 1 || attendance === 2) return "✓";
  if (attendance === -1) return "–";
  return "◷";
}

function peekAnchor(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.right + 6, y: r.top };
}

function StaffDayColumn({
  master,
  rows,
  day,
  className,
  hourPx = HOUR_PX,
  stripPx = STRIP_PX,
  nowTop = null,
  onEmptySlot,
  onStripEnter,
  onStripLeave,
  showPeek,
  closePeek,
  onAppointment,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
}: {
  master: JournalMaster;
  rows: JournalGridAppointment[];
  day: string;
  className: string;
  hourPx?: number;
  stripPx?: number;
  nowTop?: number | null;
  onEmptySlot: (masterId: string, datetimeLocal: string) => void;
  onStripEnter: (row: JournalGridAppointment, el: HTMLElement) => void;
  onStripLeave: () => void;
  showPeek: (row: JournalGridAppointment, el: HTMLElement, pinned: boolean) => void;
  closePeek: () => void;
  onAppointment: (row: JournalGridAppointment) => void;
  onTouchStart: (row: JournalGridAppointment, el: HTMLElement) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchMove: () => void;
}) {
  const pxPerMin = hourPx / 60;
  const laid = layoutColumn(rows, pxPerMin);
  return (
    <div
      className={`relative border-l border-gray-100 cursor-pointer ${className}`}
      style={{ height: bodyHeight(hourPx) }}
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const rawMin = START_HOUR * 60 + y / pxPerMin;
        const snapped = Math.min(
          (END_HOUR - 1) * 60 + 45,
          Math.max(START_HOUR * 60, Math.round(rawMin / 15) * 15),
        );
        const hm = minutesToHm(snapped);
        onEmptySlot(master.id, `${day}T${hm}`);
      }}
    >
      {Array.from({ length: (END_HOUR - START_HOUR) * 2 + 1 }, (_, i) => (
        <div
          key={i}
          className={`absolute left-0 right-0 pointer-events-none ${i % 2 === 0 ? "border-t border-gray-200" : "border-t border-gray-100"}`}
          style={{ top: i * (hourPx / 2) }}
        />
      ))}
      {nowTop != null ? (
        <div
          className="absolute left-0 right-0 z-20 pointer-events-none border-t-2 border-[#ff7a18]"
          style={{ top: nowTop }}
        />
      ) : null}
      {laid.map((item) => {
        const { row, top, height, lane, startMin, endMin } = item;
        const startHm = minutesToHm(startMin);
        const endHm = minutesToHm(endMin);
        const titles = row.lines.map((l) => l.title).filter(Boolean);
        const phone = phoneOf(row);
        const att = normalizeAttendance(row.attendance);
        const colors = attendanceBlockStyle(att);
        const leftPx = 3 + lane * OVERLAP_OFFSET_PX;
        return (
          <div
            key={row.id}
            className={`absolute overflow-hidden rounded-md border text-left shadow-sm flex flex-col ${
              row.status === "sync_error" ? "ring-2 ring-red-500" : ""
            }`}
            style={{
              top: Math.max(0, top),
              height,
              left: leftPx,
              right: 3,
              zIndex: 10 + lane,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              color: colors.text,
            }}
            title={row.syncError || undefined}
          >
            <div
              className="shrink-0 flex items-center justify-between gap-1 px-1.5 text-white cursor-default select-none"
              style={{ backgroundColor: colors.strip, height: stripPx }}
              data-journal-strip="1"
              onMouseEnter={(e) => {
                e.stopPropagation();
                onStripEnter(row, e.currentTarget);
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                onStripLeave();
              }}
              onClick={(e) => {
                e.stopPropagation();
                showPeek(row, e.currentTarget, true);
              }}
              onTouchStart={(e) => onTouchStart(row, e.currentTarget)}
              onTouchEnd={onTouchEnd}
              onTouchMove={() => onTouchMove()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="text-[11px] font-semibold tabular-nums leading-none truncate">
                {startHm}-{endHm}
              </span>
              <span
                className="w-4 h-4 rounded-full bg-white/30 text-[11px] leading-none flex items-center justify-center shrink-0"
                aria-hidden
              >
                {stripMark(att)}
              </span>
            </div>
            <button
              type="button"
              className="min-h-0 flex-1 overflow-hidden px-1.5 pt-1 pb-1 flex flex-col justify-start items-stretch gap-0.5 text-left w-full"
              style={{ color: colors.text }}
              onClick={(e) => {
                e.stopPropagation();
                closePeek();
                onAppointment(row);
              }}
            >
              <div className="text-[12px] font-semibold leading-tight line-clamp-2">
                <ClientNameWithLoyalty
                  name={clientLabelOf(row)}
                  spent={row.directClient?.spent}
                  visits={row.directClient?.visits}
                  nameClassName="text-[12px] font-semibold leading-tight"
                  className="gap-1 items-center max-w-full"
                  showBadge={height >= 70}
                />
              </div>
              {height >= 64 && phone ? (
                <div className="text-[11px] font-medium leading-tight line-clamp-1">{phone}</div>
              ) : null}
              {height >= 80 && titles.length > 0 ? (
                <div className="text-[11px] font-medium leading-snug line-clamp-6">{titles.join(" — ")}</div>
              ) : null}
              {height >= 84 &&
              row.checkout?.status === "synced" &&
              Number(row.checkout.paidAmount) > 0 ? (
                <div className="truncate text-[10px] font-medium leading-tight">
                  оплачено {Number(row.checkout.paidAmount).toLocaleString("uk-UA")} грн
                </div>
              ) : null}
              {row.status === "sync_error" ? (
                <div className="text-[10px] text-red-800 font-semibold leading-tight">помилка sync</div>
              ) : null}
            </button>
          </div>
        );
      })}
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
  onAttendanceChange,
}: {
  day: string;
  masters: JournalMaster[];
  appointments: JournalGridAppointment[];
  loading?: boolean;
  onEmptySlot: (masterId: string, datetimeLocal: string) => void;
  onAppointment: (row: JournalGridAppointment) => void;
  onAttendanceChange?: (appointmentId: string, attendance: number) => void;
}) {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const peekRef = useRef(peek);
  peekRef.current = peek;

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const clearLeaveTimer = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const closePeek = useCallback(() => {
    clearHoverTimer();
    clearLeaveTimer();
    setPeek(null);
  }, []);

  const showPeek = useCallback((row: JournalGridAppointment, el: HTMLElement, pinned: boolean) => {
    clearLeaveTimer();
    const { x, y } = peekAnchor(el);
    setPeek({ row, pinned, x, y });
  }, []);

  const onStripEnter = (row: JournalGridAppointment, el: HTMLElement) => {
    clearLeaveTimer();
    if (peekRef.current?.pinned) return;
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => {
      showPeek(row, el, false);
    }, HOVER_DELAY_MS);
  };

  const onStripLeave = () => {
    clearHoverTimer();
    if (peekRef.current?.pinned) return;
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => {
      if (!peekRef.current?.pinned) setPeek(null);
    }, 200);
  };

  const onPanelEnter = () => {
    clearLeaveTimer();
  };

  const onPanelLeave = () => {
    if (peekRef.current?.pinned) return;
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => {
      if (!peekRef.current?.pinned) setPeek(null);
    }, 200);
  };

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearLeaveTimer();
      clearLongPress();
    };
  }, []);

  const byStaff = new Map<string, JournalGridAppointment[]>();
  for (const row of appointments) {
    const key = staffKey(row);
    const list = byStaff.get(key) || [];
    list.push(row);
    byStaff.set(key, list);
  }

  const nowMin = day === kyivTodayYmd() ? kyivNowMinutes() : null;
  const nowVisible = nowMin != null && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;
  const phoneNowTop = nowVisible ? (nowMin - START_HOUR * 60) * (PHONE_HOUR_PX / 60) : null;
  const deskNowTop = nowVisible ? (nowMin - START_HOUR * 60) * PX_PER_MIN : null;
  const nowLabel = nowMin != null ? minutesToHm(nowMin) : "";

  const columnProps = {
    day,
    onEmptySlot,
    onStripEnter,
    onStripLeave,
    showPeek,
    closePeek,
    onAppointment,
    onTouchStart: (row: JournalGridAppointment, el: HTMLElement) => {
      longPressFired.current = false;
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        showPeek(row, el, true);
      }, LONG_PRESS_MS);
    },
    onTouchEnd: (e: TouchEvent) => {
      clearLongPress();
      if (longPressFired.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onTouchMove: () => clearLongPress(),
  };

  return (
    <div>
      <div className="md:hidden bg-white">
        {masters.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-500 text-center">Немає майстрів у штаті Altegio</div>
        ) : (
          <div className="overflow-x-auto relative">
            <div className="flex w-max min-w-full">
              <div className="sticky left-0 z-20 bg-white shrink-0">
                <div className="h-[4.75rem] flex items-center justify-center">
                  <button
                    type="button"
                    className="w-8 h-8 text-[28px] leading-none text-[#f5c400] font-light"
                    aria-label="Новий запис"
                    onClick={() => masters[0] && onEmptySlot(masters[0].id, `${day}T10:00`)}
                  >
                    +
                  </button>
                </div>
                <div className="relative">
                  <TimeGutter hourPx={PHONE_HOUR_PX} full />
                  {phoneNowTop != null ? (
                    <div
                      className="absolute right-0 z-30 -translate-y-1/2"
                      style={{ top: phoneNowTop }}
                    >
                      <span className="inline-flex rounded-full bg-[#ff7a18] text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums">
                        {nowLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {masters.map((m) => (
                <div key={m.id} className="w-[7.1rem] shrink-0">
                  <div className="h-[4.75rem] px-1 flex flex-col items-center justify-end pb-1.5 gap-1">
                    <MasterColumnAvatar
                      name={m.name}
                      instagramUsername={m.instagramUsername}
                      className="w-10 h-10 text-[12px]"
                    />
                    <span className="text-[11px] leading-tight text-center text-gray-800 line-clamp-2 w-full">
                      {m.name}
                    </span>
                  </div>
                  <StaffDayColumn
                    master={m}
                    rows={byStaff.get(String(m.altegioStaffId || m.id)) || []}
                    className="w-full"
                    hourPx={PHONE_HOUR_PX}
                    stripPx={PHONE_STRIP_PX}
                    nowTop={phoneNowTop}
                    {...columnProps}
                  />
                </div>
              ))}
            </div>
            {loading && <div className="absolute inset-0 bg-white/40 pointer-events-none" />}
          </div>
        )}
      </div>

      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto snap-x snap-mandatory">
        <div className="w-max min-w-full">
          <div className="flex border-b border-gray-100">
            <div className="w-10 shrink-0" />
            {masters.map((m) => (
              <div key={m.id} className="flex-1 min-w-[180px] md:min-w-[210px] snap-start px-3 py-2.5 flex items-center gap-2 border-l border-gray-100">
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
            {masters.map((m) => (
              <StaffDayColumn
                key={m.id}
                master={m}
                rows={byStaff.get(String(m.altegioStaffId || m.id)) || []}
                className="flex-1 min-w-[180px] md:min-w-[210px] snap-start"
                nowTop={deskNowTop}
                {...columnProps}
              />
            ))}
            <TimeGutter />
            {loading && <div className="absolute inset-0 bg-white/40 pointer-events-none" />}
          </div>
        </div>
      </div>

      {peek && (
        <JournalAppointmentPeek
          peek={peek}
          onClose={closePeek}
          onMouseEnterPanel={onPanelEnter}
          onMouseLeavePanel={onPanelLeave}
          onAttendanceChange={(appointmentId, attendance) => {
            setPeek((prev) =>
              prev && prev.row.id === appointmentId
                ? { ...prev, row: { ...prev.row, attendance } }
                : prev,
            );
            onAttendanceChange?.(appointmentId, attendance);
          }}
        />
      )}
    </div>
  );
}
