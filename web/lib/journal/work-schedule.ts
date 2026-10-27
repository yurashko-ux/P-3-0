// Графік змін майстрів з Altegio: читання і запис інтервалів робочого дня.

import { altegioFetch } from "@/lib/altegio/client";
import { resolveJournalCompanyId } from "./company-id";
import { hasAssignedPosition, isCalendarMaster, listJournalStaffFromAltegio, type JournalStaff } from "./staff";

export type WorkSlot = { from: string; to: string };

export type ScheduleStaff = {
  id: number;
  name: string;
  positionTitle: string;
  avatarUrl: string | null;
};

export type WorkSchedule = {
  staff: ScheduleStaff[];
  slots: Record<string, WorkSlot[]>;
};

function unwrapList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  return [];
}

function hm(value: unknown): string | null {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function slotsOf(raw: unknown): WorkSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: WorkSlot[] = [];
  for (const item of raw) {
    const from = hm(item?.from ?? item?.start ?? item?.time_from);
    const to = hm(item?.to ?? item?.end ?? item?.time_to);
    if (from && to) slots.push({ from, to });
  }
  return slots;
}

function remember(
  map: Map<string, WorkSlot[]>,
  staffId: number,
  date: string,
  slots: WorkSlot[],
) {
  if (!(staffId > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  map.set(`${staffId}|${date}`, slots);
}

function collectSlots(raw: unknown): Map<string, WorkSlot[]> {
  const map = new Map<string, WorkSlot[]>();
  for (const item of unwrapList(raw)) {
    const staffId = Number(item?.staff_id ?? item?.team_member_id ?? item?.staff?.id ?? 0);
    const nested = item?.days || item?.dates || item?.schedule;
    if (Array.isArray(nested)) {
      for (const day of nested) {
        const date = String(day?.date || "").slice(0, 10);
        remember(map, staffId, date, slotsOf(day?.slots ?? day?.intervals ?? day?.seances));
      }
      continue;
    }
    const date = String(item?.date || "").slice(0, 10);
    remember(map, staffId, date, slotsOf(item?.slots ?? item?.intervals));
  }
  return map;
}

async function readSchedule(companyId: number, from: string, to: string): Promise<Map<string, WorkSlot[]>> {
  const query = `start_date=${encodeURIComponent(from)}&end_date=${encodeURIComponent(to)}`;
  const paths = [
    `/company/${companyId}/staff/schedule?${query}`,
    `/locations/${companyId}/team_members/schedule?${query}`,
  ];
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const map = collectSlots(raw);
      console.log(`[journal/schedule] Прочитано графік ${from}…${to}: ${map.size} днів (${path})`);
      return map;
    } catch (err) {
      lastError = err;
      console.warn(
        `[journal/schedule] Не вдалося прочитати ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Altegio не віддав графік роботи");
}

export async function loadWorkSchedule(from: string, to: string): Promise<WorkSchedule> {
  const companyId = resolveJournalCompanyId();
  const [staff, slots] = await Promise.all([
    listJournalStaffFromAltegio(),
    readSchedule(companyId, from, to),
  ]);
  const masters = staff.filter((row) => isCalendarMaster(row) && hasAssignedPosition(row));
  return {
    staff: masters.map(toScheduleStaff),
    slots: Object.fromEntries(slots),
  };
}

function toScheduleStaff(row: JournalStaff): ScheduleStaff {
  return {
    id: row.altegioStaffId,
    name: row.name,
    positionTitle: row.positionTitle,
    avatarUrl: row.avatarUrl || null,
  };
}

export function slotsForShift(from: string, to: string, breakFrom?: string, breakTo?: string): WorkSlot[] {
  if (breakFrom && breakTo && breakFrom > from && breakTo < to && breakFrom < breakTo) {
    return [
      { from, to: breakFrom },
      { from: breakTo, to },
    ];
  }
  return [{ from, to }];
}

export async function saveWorkSchedule(input: {
  staffIds: number[];
  dates: string[];
  slots?: WorkSlot[];
  off?: boolean;
}): Promise<void> {
  const companyId = resolveJournalCompanyId();
  const staffIds = input.staffIds.filter((id) => id > 0);
  const dates = input.dates.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (staffIds.length === 0 || dates.length === 0) {
    throw new Error("Оберіть майстра і день");
  }
  const body = input.off
    ? {
        schedules_to_delete: staffIds.map((staff_id) => ({ staff_id, dates })),
      }
    : {
        schedules_to_set: staffIds.map((staff_id) => ({
          staff_id,
          dates,
          slots: input.slots || [],
        })),
      };
  const paths = [
    `/company/${companyId}/staff/schedule`,
    `/locations/${companyId}/team_members/schedule`,
  ];
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      await altegioFetch(path, { method: "PUT", body: JSON.stringify(body) });
      console.log(
        `[journal/schedule] Збережено графік ${input.off ? "вихідний" : "зміна"} ` +
          `staff=${staffIds.join(",")} days=${dates.join(",")}`,
      );
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[journal/schedule] Не вдалося зберегти ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Altegio не зберіг графік");
}
