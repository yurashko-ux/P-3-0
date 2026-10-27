// Місячна завантаженість календаря журналу: графік Altegio + записи в базі.

import { prisma } from "@/lib/prisma";
import { hasAssignedPosition, isCalendarColumn, listJournalStaffFromAltegio } from "@/lib/journal/staff";
import { isHiddenJournalStaff, loadHiddenStaffIndex } from "@/lib/team/hidden-staff";
import { loadWorkSchedule } from "@/lib/journal/work-schedule";
import {
  computeDayWorkload,
  kyivMinutesOfDay,
  type DayWorkload,
} from "@/lib/journal/day-workload";

export type { DayWorkload };

function monthBounds(month: string): { from: string; to: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(Number(match[1]), mon, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`,
  };
}

export async function loadMonthWorkload(month: string): Promise<Record<string, DayWorkload>> {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error("Потрібен місяць у форматі YYYY-MM");

  const [schedule, staffAll, hidden] = await Promise.all([
    loadWorkSchedule(bounds.from, bounds.to),
    listJournalStaffFromAltegio(),
    loadHiddenStaffIndex(),
  ]);
  const staffIds = staffAll
    .filter(hasAssignedPosition)
    .filter(isCalendarColumn)
    .filter((row) => !isHiddenJournalStaff(hidden, row))
    .map((row) => row.altegioStaffId)
    .filter((id) => id > 0);

  const appointments =
    staffIds.length === 0
      ? []
      : await prisma.salonAppointment.findMany({
          where: {
            kyivDay: { gte: bounds.from, lte: bounds.to },
            status: { not: "deleted" },
            altegioStaffId: { in: staffIds },
          },
          select: { kyivDay: true, datetime: true, seanceLength: true, altegioStaffId: true },
        });

  const days = computeDayWorkload({
    staffIds,
    slots: schedule.slots,
    appointments: appointments.map((row) => {
      const startMin = kyivMinutesOfDay(row.datetime);
      const durationMin = Math.max(0, Math.round((Number(row.seanceLength) || 0) / 60));
      return {
        kyivDay: row.kyivDay,
        altegioStaffId: row.altegioStaffId || 0,
        startMin,
        endMin: startMin + durationMin,
      };
    }),
  });
  console.log(
    `[journal/workload] ${month}: колонок ${staffIds.length}, записів ${appointments.length}, кілець ${Object.keys(days).length}`,
  );
  return days;
}
