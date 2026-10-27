// Завантаженість дня для кільця календаря.
// Зайняті хвилини (об'єднання записів всередині зміни) / робочі хвилини зміни.
// Поріги як у Altegio: <50% зелений, <75% жовтий, інакше червоний.

export const WORKLOAD_COLORS = {
  green: "#69CE14",
  yellow: "#F2C30C",
  red: "#D1050B",
} as const;

export type WorkloadColor = keyof typeof WORKLOAD_COLORS;

export type DayWorkload = {
  percent: number;
  color: WorkloadColor;
};

type Interval = [number, number];

export function hmToMin(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;
  if (hour === 24 && minute !== 0) return null;
  return hour * 60 + minute;
}

export function unionMinutes(intervals: Interval[]): number {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let open = false;
  let start = 0;
  let end = 0;
  for (const [nextStart, nextEnd] of sorted) {
    if (!open) {
      start = nextStart;
      end = nextEnd;
      open = true;
      continue;
    }
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
      continue;
    }
    total += end - start;
    start = nextStart;
    end = nextEnd;
  }
  if (open) total += end - start;
  return total;
}

function clipToSlots(start: number, end: number, slots: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [slotStart, slotEnd] of slots) {
    const from = Math.max(start, slotStart);
    const to = Math.min(end, slotEnd);
    if (to > from) out.push([from, to]);
  }
  return out;
}

export function workloadColor(ratio: number): WorkloadColor {
  if (ratio < 0.5) return "green";
  if (ratio < 0.75) return "yellow";
  return "red";
}

export function kyivMinutesOfDay(dt: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dt);
  let hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

export type WorkloadSlot = { from: string; to: string };

export type WorkloadAppointment = {
  kyivDay: string;
  altegioStaffId: number;
  startMin: number;
  endMin: number;
};

/** Ключ слота графіка: `${staffId}|${YYYY-MM-DD}`. */
export function computeDayWorkload(input: {
  staffIds: number[];
  slots: Record<string, WorkloadSlot[]>;
  appointments: WorkloadAppointment[];
}): Record<string, DayWorkload> {
  const staff = new Set(input.staffIds.filter((id) => id > 0));
  const slotsByStaffDay = new Map<string, Interval[]>();
  for (const [key, slots] of Object.entries(input.slots)) {
    const [staffRaw, day] = key.split("|");
    const staffId = Number(staffRaw);
    if (!staff.has(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(day || "")) continue;
    const intervals: Interval[] = [];
    for (const slot of slots) {
      const from = hmToMin(slot.from);
      const to = hmToMin(slot.to);
      if (from == null || to == null || to <= from) continue;
      intervals.push([from, to]);
    }
    if (intervals.length > 0) slotsByStaffDay.set(key, intervals);
  }

  const apptsByStaffDay = new Map<string, Interval[]>();
  for (const appt of input.appointments) {
    if (!staff.has(appt.altegioStaffId)) continue;
    if (appt.endMin <= appt.startMin) continue;
    const key = `${appt.altegioStaffId}|${appt.kyivDay}`;
    const list = apptsByStaffDay.get(key) || [];
    list.push([appt.startMin, appt.endMin]);
    apptsByStaffDay.set(key, list);
  }

  const workingByDay = new Map<string, number>();
  const bookedByDay = new Map<string, number>();
  for (const [key, slots] of slotsByStaffDay) {
    const day = key.split("|")[1];
    const working = unionMinutes(slots);
    if (working <= 0) continue;
    workingByDay.set(day, (workingByDay.get(day) || 0) + working);
    const clipped = (apptsByStaffDay.get(key) || []).flatMap(([start, end]) => clipToSlots(start, end, slots));
    const booked = unionMinutes(clipped);
    if (booked > 0) bookedByDay.set(day, (bookedByDay.get(day) || 0) + booked);
  }

  const days: Record<string, DayWorkload> = {};
  for (const [day, working] of workingByDay) {
    const booked = bookedByDay.get(day) || 0;
    if (!(working > 0) || !(booked > 0)) continue;
    const ratio = Math.min(1, booked / working);
    const percent = Math.max(1, Math.round(ratio * 100));
    days[day] = { percent, color: workloadColor(ratio) };
  }
  return days;
}
