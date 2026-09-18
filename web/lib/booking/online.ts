// Онлайн-запис (етап 7): слоти + dual-write через журнал.

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/binotel/normalize-phone";
import { saveDirectClient } from "@/lib/direct-store";
import { getDirectClientByAltegioId } from "@/lib/direct-store";
import type { DirectClient } from "@/lib/direct-types";
import { ensureAltegioClientId } from "@/lib/altegio/clients-write";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import {
  createAppointmentFromKresco,
  listAppointmentsForDay,
} from "@/lib/journal";
import {
  listJournalStaffFromAltegio,
  hasAssignedPosition,
  isCalendarMaster,
} from "@/lib/journal/staff";

export const BOOKING_START_HOUR = 9;
export const BOOKING_END_HOUR = 20;
export const BOOKING_SLOT_STEP_MIN = 15;
export const BOOKING_HORIZON_DAYS = 14;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function kyivNowParts(): { ymd: string; hm: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value || "00";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hm = `${get("hour")}:${get("minute")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { ymd, hm, minutes };
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToHm(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function listBookableMasters() {
  const staff = await listJournalStaffFromAltegio();
  return staff.filter((s) => hasAssignedPosition(s) && isCalendarMaster(s)).map((s) => ({
    id: String(s.altegioStaffId),
    name: s.name,
    altegioStaffId: s.altegioStaffId,
  }));
}

export async function listBookableServices() {
  return prisma.salonService.findMany({
    where: { isActive: true },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      kind: true,
      durationSec: true,
      altegioServiceId: true,
    },
  });
}

export function listBookableDays(): string[] {
  const today = kyivCalendarTodayYmd();
  const [y, m, d] = today.split("-").map(Number);
  const days: string[] = [];
  // Будуємо календарні дні Kyiv через полудень UTC+3 наближенням: ітеруємо Date з +1 day від wall.
  const baseUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < BOOKING_HORIZON_DAYS; i++) {
    const dt = new Date(baseUtc + i * 24 * 60 * 60 * 1000);
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
    days.push(ymd);
  }
  return days;
}

export async function listAvailableSlots(params: {
  day: string;
  staffId: number;
  durationSec: number;
}): Promise<string[]> {
  const day = String(params.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Некоректна дата");
  const staffId = Number(params.staffId) || 0;
  if (!(staffId > 0)) throw new Error("Оберіть майстра");
  const durationMin = Math.max(15, Math.round((Number(params.durationSec) || 3600) / 60));

  try {
    const { syncAppointmentsRangeFromAltegio } = await import("@/lib/journal");
    await syncAppointmentsRangeFromAltegio({ startDate: day, endDate: day, enrich: false });
  } catch (err) {
    console.warn(
      "[booking] Денна синхронізація перед слотами:",
      err instanceof Error ? err.message : err,
    );
  }

  const appointments = await listAppointmentsForDay(day);
  const busy = appointments
    .filter((a) => Number(a.altegioStaffId) === staffId)
    .map((a) => {
      const startHm = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Kyiv",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(a.datetime));
      const start = hmToMin(startHm);
      const end = start + Math.max(15, Math.round((Number(a.seanceLength) || 3600) / 60));
      return { start, end };
    });

  const now = kyivNowParts();
  const slots: string[] = [];
  for (let t = BOOKING_START_HOUR * 60; t + durationMin <= BOOKING_END_HOUR * 60; t += BOOKING_SLOT_STEP_MIN) {
    if (day === now.ymd && t <= now.minutes) continue;
    const end = t + durationMin;
    const conflict = busy.some((b) => rangesOverlap(t, end, b.start, b.end));
    if (!conflict) slots.push(minToHm(t));
  }
  return slots;
}

async function findDirectClientByPhone(phoneNorm: string) {
  const clients = await prisma.directClient.findMany({
    where: { phone: { not: null } },
    select: {
      id: true,
      phone: true,
      altegioClientId: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
    },
    take: 5000,
  });
  return clients.find((c) => c.phone && normalizePhone(c.phone) === phoneNorm) || null;
}

async function resolveDefaultStatusId(): Promise<string> {
  const preferred = await prisma.directStatus.findFirst({
    where: {
      OR: [{ id: "phone" }, { name: { contains: "Телефон", mode: "insensitive" } }, { isDefault: true }],
    },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  if (preferred?.id) return preferred.id;
  const any = await prisma.directStatus.findFirst({
    orderBy: { order: "asc" },
    select: { id: true },
  });
  return any?.id || "phone";
}

/** Знайти/створити Direct + Altegio клієнта для публічного запису. */
export async function ensureBookingClient(params: {
  name: string;
  phone: string;
}): Promise<{ directClientId: string; altegioClientId: number }> {
  const phoneNorm = normalizePhone(params.phone);
  if (!/^380\d{9}$/.test(phoneNorm)) {
    throw new Error("Телефон у форматі +380XXXXXXXXX");
  }
  const name = String(params.name || "").trim();
  if (name.length < 2) throw new Error("Вкажіть імʼя");

  const { altegioClientId } = await ensureAltegioClientId({
    name,
    phone: phoneNorm,
    comment: "онлайн-запис Kresco",
  });

  const byAltegio = await getDirectClientByAltegioId(altegioClientId);
  if (byAltegio) {
    if (!byAltegio.phone || normalizePhone(byAltegio.phone) !== phoneNorm) {
      await prisma.directClient.update({
        where: { id: byAltegio.id },
        data: {
          phone: phoneNorm,
          ...(byAltegio.firstName ? {} : { firstName: name.split(/\s+/)[0] || name }),
        },
      });
    }
    return { directClientId: byAltegio.id, altegioClientId };
  }

  const byPhone = await findDirectClientByPhone(phoneNorm);
  if (byPhone) {
    if (!(byPhone.altegioClientId && byPhone.altegioClientId > 0)) {
      await prisma.directClient.update({
        where: { id: byPhone.id },
        data: { altegioClientId },
      });
    }
    return { directClientId: byPhone.id, altegioClientId };
  }

  const nowIso = new Date().toISOString();
  const nameParts = name.split(/\s+/).filter(Boolean);
  const statusId = await resolveDefaultStatusId();
  const client: DirectClient = {
    id: `direct_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    instagramUsername: `online_${phoneNorm}`,
    firstName: nameParts[0] || name,
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
    phone: phoneNorm,
    source: "other",
    statusId,
    state: "consultation-booked",
    firstContactDate: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    visitedSalon: false,
    signedUpForPaidService: false,
    includeInNewLeadsKpi: false,
    altegioClientId,
    comment: "онлайн-запис",
  };
  await saveDirectClient(client, "online-booking", { source: "book" }, { skipAltegioMetricsSync: true });
  console.log(`[booking] ✅ Direct клієнт ${client.id} linked altegio=${altegioClientId}`);
  return { directClientId: client.id, altegioClientId };
}

export async function createOnlineBooking(params: {
  name: string;
  phone: string;
  serviceId: string;
  staffId: string | number;
  day: string;
  time: string;
  comment?: string | null;
}) {
  const serviceId = String(params.serviceId || "");
  if (!serviceId) throw new Error("Оберіть послугу");
  const service = await prisma.salonService.findFirst({
    where: { id: serviceId, isActive: true },
  });
  if (!service) throw new Error("Послугу не знайдено");

  const day = String(params.day || "").trim();
  const time = String(params.time || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Некоректна дата");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Некоректний час");

  const slots = await listAvailableSlots({
    day,
    staffId: Number(params.staffId),
    durationSec: service.durationSec || 3600,
  });
  if (!slots.includes(time)) {
    throw new Error("Цей час уже зайнятий — оберіть інший слот");
  }

  const { directClientId } = await ensureBookingClient({
    name: params.name,
    phone: params.phone,
  });

  const commentParts = ["онлайн-запис", params.comment ? String(params.comment).trim() : ""].filter(Boolean);
  const appointment = await createAppointmentFromKresco({
    directClientId,
    masterId: String(params.staffId),
    datetime: `${day}T${time}`,
    seanceLength: service.durationSec || 3600,
    comment: commentParts.join(": "),
    attendance: 0,
    serviceIds: [service.id],
  });

  const kyivDay = kyivYmdFromDateTimeInput(appointment.datetime) || day;
  console.log(
    `[booking] ✅ Онлайн-запис appointment=${appointment.id} day=${kyivDay} time=${time} staff=${params.staffId}`,
  );
  return appointment;
}
