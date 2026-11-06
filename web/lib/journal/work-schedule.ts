// Графік змін: читаємо з Kresco, запис і в Kresco, і в Altegio. Зміни з Altegio підтягує cron.

import { altegioFetch } from "@/lib/altegio/client";
import { prisma } from "@/lib/prisma";
import { readTeamMemberAvatar } from "@/lib/team/avatar";
import { resolveJournalCompanyId } from "./company-id";
import { hasAssignedPosition, isCalendarMaster, listJournalStaff, type JournalStaff } from "./staff";

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

async function readStoredSchedule(from: string, to: string): Promise<Map<string, WorkSlot[]>> {
  const rows = await prisma.teamWorkDay.findMany({
    where: { kyivDay: { gte: from, lte: to } },
    select: { altegioStaffId: true, kyivDay: true, slots: true },
  });
  return new Map(rows.map((r) => [`${r.altegioStaffId}|${r.kyivDay}`, r.slots as WorkSlot[]]));
}

async function importedSchedule(from: string, to: string): Promise<Map<string, WorkSlot[]>> {
  const fromAltegio = await readSchedule(resolveJournalCompanyId(), from, to);
  await storeSchedule(fromAltegio, from, to);
  return fromAltegio;
}

/** Пише лише змінені дні. Порожню відповідь Altegio не вважаємо «усі вихідні». */
async function storeSchedule(incoming: Map<string, WorkSlot[]>, from: string, to: string) {
  const working = new Map([...incoming].filter(([, slots]) => slots.length > 0));
  const existing = await prisma.teamWorkDay.findMany({
    where: { kyivDay: { gte: from, lte: to } },
    select: { id: true, altegioStaffId: true, kyivDay: true, slots: true },
  });
  if (working.size === 0 && existing.length > 0) {
    console.warn(`[journal/schedule] Altegio повернув порожній графік ${from}…${to} — Kresco не чіпаємо`);
    return { written: 0, removed: 0 };
  }
  const byKey = new Map(existing.map((r) => [`${r.altegioStaffId}|${r.kyivDay}`, r]));
  const removedIds = existing
    .filter((r) => !working.has(`${r.altegioStaffId}|${r.kyivDay}`))
    .map((r) => r.id);
  if (removedIds.length > 0) {
    await prisma.teamWorkDay.deleteMany({ where: { id: { in: removedIds } } });
  }
  let written = 0;
  for (const [key, slots] of working) {
    if (JSON.stringify(byKey.get(key)?.slots) === JSON.stringify(slots)) continue;
    const [staffId, kyivDay] = key.split("|");
    await upsertDay(Number(staffId), kyivDay, slots);
    written += 1;
  }
  return { written, removed: removedIds.length };
}

async function upsertDay(altegioStaffId: number, kyivDay: string, slots: WorkSlot[]) {
  await prisma.teamWorkDay.upsert({
    where: { altegioStaffId_kyivDay: { altegioStaffId, kyivDay } },
    create: { altegioStaffId, kyivDay, slots },
    update: { slots },
  });
}

export async function syncWorkScheduleFromAltegio(from: string, to: string) {
  const fromAltegio = await readSchedule(resolveJournalCompanyId(), from, to);
  const stats = await storeSchedule(fromAltegio, from, to);
  return { days: fromAltegio.size, ...stats };
}

export async function loadWorkSchedule(from: string, to: string): Promise<WorkSchedule> {
  const [staff, stored] = await Promise.all([listJournalStaff(), readStoredSchedule(from, to)]);
  // Місяць ще не імпортовано: забираємо з Altegio і зберігаємо.
  const slots = stored.size > 0 ? stored : await importedSchedule(from, to);
  const masters = staff.filter((row) => isCalendarMaster(row) && hasAssignedPosition(row));
  const photos = await Promise.all(
    masters.map((row) => (row.teamMemberId ? readTeamMemberAvatar(row.teamMemberId).catch(() => null) : null)),
  );
  return {
    staff: masters.map((row, i) =>
      toScheduleStaff(photos[i] ? { ...row, avatarUrl: `/api/admin/team/members/${row.teamMemberId}/avatar` } : row),
    ),
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
      if (input.off) {
        await prisma.teamWorkDay.deleteMany({
          where: { altegioStaffId: { in: staffIds }, kyivDay: { in: dates } },
        });
      } else {
        for (const staffId of staffIds) {
          for (const day of dates) await upsertDay(staffId, day, input.slots || []);
        }
      }
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
