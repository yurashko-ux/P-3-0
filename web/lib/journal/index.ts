// Журнал запису: upsert з Altegio (вебхук/крон) і dual-write з Kresco.

import { prisma } from "@/lib/prisma";
import { kyivYmdFromDateTimeInput, kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { getDirectClientByAltegioId } from "@/lib/direct-store";
import { getMasterByAltegioStaffId } from "@/lib/direct-masters/store";
import {
  createAltegioRecord,
  deleteAltegioRecord,
  updateAltegioRecord,
} from "@/lib/altegio/records-write";
import { altegioFetch } from "@/lib/altegio/client";
import { pickAltegioClientSnapshot, pickAltegioRecordDateTime, pickAltegioSeanceLength } from "@/lib/altegio/records";
import { ensureSalonServiceFromLine } from "./services";
import { listJournalStaffFromAltegio, hasAssignedPosition } from "./staff";
import { resolveJournalCompanyId } from "./company-id";

function formatKyivDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function parseDatetime(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAppointmentDatetime(value: unknown): Date | null {
  if (value instanceof Date) return parseDatetime(value);
  const raw = String(value || "").trim();
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(raw);
  if (!m) return parseDatetime(raw);
  const wall = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(raw);
  // Z або +00:00 у Altegio часто означає місцевий час філії, не справжній UTC.
  const isUtcTagged = /Z$/i.test(raw) || (offset != null && offset[2] === "00" && offset[3] === "00");
  if (offset && !isUtcTagged) return parseDatetime(raw);
  return parseKyivWallClock(wall);
}

function normalizeSeanceLength(raw: unknown, serviceDurationsSec: number[] = []): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return n < 300 ? Math.round(n * 60) : Math.round(n);
  }
  const sum = serviceDurationsSec.reduce((a, x) => a + (Number(x) || 0), 0);
  if (sum > 0) return sum;
  return 3600;
}

function parseKyivWallClock(value: unknown): Date | null {
  const raw = String(value || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(raw);
  if (!m) return parseDatetime(value);
  const wall = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const utcGuess = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`);
  if (!Number.isFinite(utcGuess)) return null;
  for (const shiftMin of [180, 120, 0, 240]) {
    const candidate = new Date(utcGuess - shiftMin * 60 * 1000);
    if (formatKyivDateTime(candidate).slice(0, 16) === wall) return candidate;
  }
  return new Date(utcGuess);
}

const altegioClientSnapCache = new Map<number, { name: string | null; phone: string | null }>();

export function clearJournalAltegioClientCache() {
  altegioClientSnapCache.clear();
}

async function fetchAltegioClientSnapshot(clientId: number): Promise<{ name: string | null; phone: string | null }> {
  const cached = altegioClientSnapCache.get(clientId);
  if (cached) return cached;
  const companyId = resolveJournalCompanyId();
  const paths = [`/client/${companyId}/${clientId}`, `/company/${companyId}/clients/${clientId}`];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<any>(path);
      const data = raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;
      const snap = pickAltegioClientSnapshot({ ...data, client: data?.client ?? data, client_id: clientId });
      if (snap.name || snap.phone) {
        const value = { name: snap.name, phone: snap.phone };
        altegioClientSnapCache.set(clientId, value);
        return value;
      }
    } catch (err) {
      console.warn(
        `[journal] Не вдалося прочитати клієнта Altegio ${clientId} (${path}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const empty = { name: null, phone: null };
  altegioClientSnapCache.set(clientId, empty);
  return empty;
}

async function fetchAltegioRecordRaw(recordId: number): Promise<any | null> {
  const companyId = resolveJournalCompanyId();
  const paths = [`/records/${companyId}/${recordId}`, `/record/${companyId}/${recordId}`];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<any>(path);
      const data = raw?.data ?? raw;
      if (data && typeof data === "object") return data;
    } catch (err) {
      console.warn(
        `[journal] Не вдалося прочитати запис Altegio ${recordId} (${path}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

export type AltegioAppointmentSyncInput = {
  status?: string;
  altegioRecordId: number | null;
  altegioVisitId?: number | null;
  altegioClientId?: number | null;
  altegioStaffId?: number | null;
  staffName?: string | null;
  datetime?: string | Date | null;
  seanceLength?: number | null;
  attendance?: number | null;
  comment?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  deleted?: boolean;
  services?: Array<{
    id?: number | null;
    title?: string | null;
    name?: string | null;
    amount?: number | null;
    cost?: number | null;
    first_cost?: number | null;
  }>;
};

function normalizeLines(services: AltegioAppointmentSyncInput["services"]) {
  const rows: Array<{ altegioServiceId: number | null; title: string; amount: number; cost: number }> = [];
  for (const s of services || []) {
    const title = String(s?.title || s?.name || "").trim();
    const id = Number(s?.id) || null;
    if (!title && !(id && id > 0)) continue;
    rows.push({
      altegioServiceId: id && id > 0 ? id : null,
      title: title || `Послуга ${id}`,
      amount: Number(s?.amount) > 0 ? Number(s.amount) : 1,
      cost: Number(s?.cost) || Number(s?.first_cost) || 0,
    });
  }
  return rows;
}

export async function upsertSalonAppointmentFromAltegio(input: AltegioAppointmentSyncInput) {
  const recordId = Number(input.altegioRecordId) || 0;
  const deleted = input.deleted === true || input.status === "delete";

  if (deleted && recordId > 0) {
    const existing = await prisma.salonAppointment.findUnique({ where: { altegioRecordId: recordId } });
    if (existing) {
      await prisma.salonAppointment.update({
        where: { id: existing.id },
        data: { status: "deleted", syncError: null },
      });
      console.log(`[journal] Запис Altegio ${recordId} позначено deleted`);
    }
    return existing;
  }

  let altegioClientId = Number(input.altegioClientId) || 0;
  let directClientId: string | null = null;
  let clientName = String(input.clientName || "").trim() || null;
  let clientPhone = String(input.clientPhone || "").trim() || null;
  let datetime = parseAppointmentDatetime(input.datetime);
  let servicesForLines = input.services;
  let seanceHint = input.seanceLength;

  const needsEnrich = !(Number(seanceHint) > 3600) || !clientName || !datetime;
  if (needsEnrich && recordId > 0) {
    const full = await fetchAltegioRecordRaw(recordId);
    if (full) {
      const snap = pickAltegioClientSnapshot(full);
      clientName = clientName || snap.name;
      clientPhone = clientPhone || snap.phone;
      const parsedFull = parseAppointmentDatetime(pickAltegioRecordDateTime(full));
      if (parsedFull) datetime = parsedFull;
      if (Array.isArray(full.services) && full.services.length > 0) {
        servicesForLines = full.services;
      }
      seanceHint = pickAltegioSeanceLength(full, full.services) ?? seanceHint;
      if (!(altegioClientId > 0) && snap.id) altegioClientId = snap.id;
    }
  }

  if (!(recordId > 0) || !datetime) {
    console.warn("[journal] Пропуск upsert: немає recordId або datetime", {
      recordId,
      datetime: input.datetime,
    });
    return null;
  }

  if (altegioClientId > 0) {
    const client = await getDirectClientByAltegioId(altegioClientId);
    directClientId = client?.id || null;
    if (client) {
      if (!clientName) {
        clientName =
          [client.lastName, client.firstName].filter(Boolean).join(" ").trim() ||
          client.instagramUsername ||
          null;
      }
      if (!clientPhone && client.phone) clientPhone = client.phone;
    }
    if (!clientName || !clientPhone) {
      const fromApi = await fetchAltegioClientSnapshot(altegioClientId);
      clientName = clientName || fromApi.name;
      clientPhone = clientPhone || fromApi.phone;
    }
  }

  const altegioStaffId = Number(input.altegioStaffId) || null;
  let masterId: string | null = null;
  if (altegioStaffId && altegioStaffId > 0) {
    const master = await getMasterByAltegioStaffId(altegioStaffId);
    masterId = master?.id || null;
  }

  const kyivDay = kyivYmdFromDateTimeInput(datetime) || "";
  const lines = normalizeLines(servicesForLines);
  const seanceLength = normalizeSeanceLength(
    seanceHint,
    (servicesForLines || []).map((s) => Number((s as any).duration ?? (s as any).seance_length ?? (s as any).length) || 0),
  );
  const attendance =
    input.attendance === -1 || input.attendance === 0 || input.attendance === 1 || input.attendance === 2
      ? input.attendance
      : null;

  const existing = await prisma.salonAppointment.findUnique({ where: { altegioRecordId: recordId } });
  const data = {
    altegioRecordId: recordId,
    altegioVisitId: Number(input.altegioVisitId) || null,
    directClientId,
    altegioClientId: altegioClientId > 0 ? altegioClientId : null,
    masterId,
    altegioStaffId,
    staffName: input.staffName ? String(input.staffName) : null,
    clientName: clientName || existing?.clientName || null,
    clientPhone: clientPhone || existing?.clientPhone || null,
    datetime,
    seanceLength,
    attendance,
    comment: input.comment ? String(input.comment) : existing?.comment || null,
    status: "synced" as const,
    syncError: null,
    source: existing?.source === "kresco" ? "kresco" : "altegio",
    kyivDay,
  };

  const appointment = existing
    ? await prisma.salonAppointment.update({ where: { id: existing.id }, data })
    : await prisma.salonAppointment.create({ data });

  await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: appointment.id } });
  for (const line of lines) {
    const service = await ensureSalonServiceFromLine({
      altegioServiceId: line.altegioServiceId,
      title: line.title,
    });
    await prisma.salonAppointmentLine.create({
      data: {
        appointmentId: appointment.id,
        serviceId: service?.id || null,
        altegioServiceId: line.altegioServiceId,
        title: line.title,
        amount: line.amount,
        cost: line.cost,
      },
    });
  }

  console.log(
    `[journal] Upsert запису Altegio ${recordId} day=${kyivDay} time=${formatKyivDateTime(datetime)} seance=${seanceLength}s client=${clientName || altegioClientId || "—"} lines=${lines.length}`,
  );
  return appointment;
}

export async function listAppointmentsForDay(kyivDay: string) {
  return prisma.salonAppointment.findMany({
    where: { kyivDay, status: { not: "deleted" } },
    include: {
      lines: true,
      directClient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          altegioClientId: true,
          phone: true,
        },
      },
      master: { select: { id: true, name: true, altegioStaffId: true } },
    },
    orderBy: { datetime: "asc" },
  });
}

export async function getSalonAppointment(id: string) {
  return prisma.salonAppointment.findUnique({
    where: { id },
    include: {
      lines: true,
      directClient: true,
      master: true,
    },
  });
}

function snapshotFromDirectClient(client: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  instagramUsername?: string | null;
}) {
  const clientName =
    [client.lastName, client.firstName].filter(Boolean).join(" ").trim() ||
    String(client.instagramUsername || "").trim() ||
    null;
  return { clientName, clientPhone: client.phone || null };
}

const appointmentWriteInclude = {
  lines: true,
  directClient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
      altegioClientId: true,
      phone: true,
    },
  },
  master: { select: { id: true, name: true, altegioStaffId: true } },
} as const;

export type KrescoAppointmentInput = {
  appointmentId?: string;
  directClientId: string;
  masterId: string;
  datetime: string;
  seanceLength?: number;
  comment?: string;
  attendance?: number;
  serviceIds: string[];
};

async function loadWriteContext(input: KrescoAppointmentInput) {
  const client = await prisma.directClient.findUnique({ where: { id: input.directClientId } });
  if (!client) throw new Error("Клієнта Direct не знайдено");
  if (!(client.altegioClientId && client.altegioClientId > 0)) {
    throw new Error("У клієнта немає id Altegio — запис у журнал Altegio неможливий");
  }

  const staffList = await listJournalStaffFromAltegio();
  let altegioStaffId = 0;
  let staffName = "";
  let directMasterId: string | null = null;

  const numericId = Number(input.masterId);
  if (Number.isFinite(numericId) && numericId > 0 && !String(input.masterId).includes("-")) {
    altegioStaffId = numericId;
  } else if (input.masterId) {
    const master = await prisma.directMaster.findUnique({ where: { id: input.masterId } });
    if (!master) throw new Error("Працівника не знайдено");
    if (!(master.altegioStaffId && master.altegioStaffId > 0)) {
      throw new Error(`У «${master.name}» немає id Altegio`);
    }
    altegioStaffId = master.altegioStaffId;
    staffName = master.name;
    directMasterId = master.id;
  }
  const staff = staffList.find((s) => s.altegioStaffId === altegioStaffId);
  if (!staff || !hasAssignedPosition(staff)) {
    throw new Error("Працівника немає в актуальному штаті Altegio з посадою");
  }
  staffName = staff.name;
  if (!directMasterId) {
    const linked = await getMasterByAltegioStaffId(altegioStaffId);
    directMasterId = linked?.id || null;
  }

  const serviceIds = [...new Set(input.serviceIds.filter(Boolean))];
  if (serviceIds.length === 0) throw new Error("Оберіть послугу");
  const services = await prisma.salonService.findMany({ where: { id: { in: serviceIds }, isActive: true } });
  if (services.length === 0) throw new Error("Послуги не знайдено. Імпортуйте довідник з Altegio.");
  const datetime = parseKyivWallClock(input.datetime);
  if (!datetime) throw new Error("Вкажіть дату і час запису");
  const seanceLength =
    Number(input.seanceLength) > 0
      ? Number(input.seanceLength)
      : Math.max(...services.map((s) => s.durationSec || 3600), 3600);
  return { client, directMasterId, altegioStaffId, staffName, services, datetime, seanceLength };
}

export async function createAppointmentFromKresco(input: KrescoAppointmentInput) {
  const ctx = await loadWriteContext(input);
  const kyivDay = kyivYmdFromDateTimeInput(ctx.datetime) || "";
  const snap = snapshotFromDirectClient(ctx.client);
  const pending = await prisma.salonAppointment.create({
    data: {
      directClientId: ctx.client.id,
      altegioClientId: ctx.client.altegioClientId,
      masterId: ctx.directMasterId,
      altegioStaffId: ctx.altegioStaffId,
      staffName: ctx.staffName,
      clientName: snap.clientName,
      clientPhone: snap.clientPhone,
      datetime: ctx.datetime,
      seanceLength: ctx.seanceLength,
      attendance: input.attendance ?? 0,
      comment: input.comment || null,
      status: "pending",
      source: "kresco",
      kyivDay,
      lines: {
        create: ctx.services.map((s) => ({
          serviceId: s.id,
          altegioServiceId: s.altegioServiceId,
          title: s.title,
          amount: 1,
          cost: 0,
        })),
      },
    },
  });

  let created: { id: number; visitId: number | null };
  try {
    created = await createAltegioRecord({
      staffId: ctx.altegioStaffId,
      clientId: ctx.client.altegioClientId as number,
      datetime: formatKyivDateTime(ctx.datetime),
      seanceLength: ctx.seanceLength,
      comment: input.comment || "",
      attendance: input.attendance ?? 0,
      services: ctx.services.map((s) => ({ id: s.altegioServiceId, amount: 1, firstCost: 0, cost: 0 })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.salonAppointment.update({
      where: { id: pending.id },
      data: { status: "sync_error", syncError: message },
    });
    console.error(`[journal] Створення запису ${pending.id} не пройшло в Altegio:`, message);
    throw new Error(message);
  }

  // Direct-колонки оновлює існуючий вебхук record (regex не дублюємо).
  // Якщо вебхук уже встиг upsert по altegioRecordId — зливаємо pending, щоб не було дубля.
  const raced = await prisma.salonAppointment.findUnique({ where: { altegioRecordId: created.id } });
  if (raced && raced.id !== pending.id) {
    await prisma.salonAppointment.delete({ where: { id: pending.id } });
    const saved = await prisma.salonAppointment.update({
      where: { id: raced.id },
      data: {
        directClientId: ctx.client.id,
        altegioClientId: ctx.client.altegioClientId,
        masterId: ctx.directMasterId,
        altegioStaffId: ctx.altegioStaffId,
        staffName: ctx.staffName,
        clientName: snap.clientName,
        clientPhone: snap.clientPhone,
        datetime: ctx.datetime,
        seanceLength: ctx.seanceLength,
        attendance: input.attendance ?? 0,
        comment: input.comment || null,
        status: "synced",
        syncError: null,
        source: "kresco",
        kyivDay,
        altegioVisitId: created.visitId,
      },
      include: appointmentWriteInclude,
    });
    console.log(`[journal] Kresco створив запис (злито з вебхуком) ${saved.id} → Altegio ${created.id}`);
    return saved;
  }
  try {
    const saved = await prisma.salonAppointment.update({
      where: { id: pending.id },
      data: {
        altegioRecordId: created.id,
        altegioVisitId: created.visitId,
        status: "synced",
        syncError: null,
      },
      include: appointmentWriteInclude,
    });
    console.log(`[journal] Kresco створив запис ${saved.id} → Altegio ${created.id}`);
    return saved;
  } catch (saveErr) {
    const racedAfter = await prisma.salonAppointment.findUnique({ where: { altegioRecordId: created.id } });
    if (racedAfter && racedAfter.id !== pending.id) {
      await prisma.salonAppointment.delete({ where: { id: pending.id } }).catch(() => undefined);
      return prisma.salonAppointment.update({
        where: { id: racedAfter.id },
        data: {
          status: "synced",
          syncError: null,
          source: "kresco",
          directClientId: ctx.client.id,
          masterId: ctx.directMasterId,
        },
        include: appointmentWriteInclude,
      });
    }
    throw saveErr;
  }
}

export async function updateAppointmentFromKresco(input: KrescoAppointmentInput) {
  if (!input.appointmentId) throw new Error("Немає id запису для оновлення");
  const existing = await prisma.salonAppointment.findUnique({
    where: { id: input.appointmentId },
    include: { lines: true },
  });
  if (!existing) throw new Error("Запис не знайдено");
  if (!(existing.altegioRecordId && existing.altegioRecordId > 0)) {
    throw new Error("Запис ще не має id Altegio — спочатку проведіть створення");
  }
  const ctx = await loadWriteContext(input);
  const kyivDay = kyivYmdFromDateTimeInput(ctx.datetime) || "";
  const snap = snapshotFromDirectClient(ctx.client);

  await prisma.salonAppointment.update({
    where: { id: existing.id },
    data: {
      directClientId: ctx.client.id,
      altegioClientId: ctx.client.altegioClientId,
      masterId: ctx.directMasterId,
      altegioStaffId: ctx.altegioStaffId,
      staffName: ctx.staffName,
      clientName: snap.clientName,
      clientPhone: snap.clientPhone,
      datetime: ctx.datetime,
      seanceLength: ctx.seanceLength,
      attendance: input.attendance ?? existing.attendance,
      comment: input.comment ?? existing.comment,
      status: "pending",
      kyivDay,
      source: "kresco",
    },
  });
  await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: existing.id } });
  await prisma.salonAppointmentLine.createMany({
    data: ctx.services.map((s) => ({
      appointmentId: existing.id,
      serviceId: s.id,
      altegioServiceId: s.altegioServiceId,
      title: s.title,
      amount: 1,
      cost: 0,
    })),
  });

  try {
    await updateAltegioRecord(existing.altegioRecordId, {
      staffId: ctx.altegioStaffId,
      clientId: ctx.client.altegioClientId as number,
      datetime: formatKyivDateTime(ctx.datetime),
      seanceLength: ctx.seanceLength,
      comment: input.comment || "",
      attendance: input.attendance ?? existing.attendance ?? 0,
      services: ctx.services.map((s) => ({ id: s.altegioServiceId, amount: 1, firstCost: 0, cost: 0 })),
    });
    return prisma.salonAppointment.update({
      where: { id: existing.id },
      data: { status: "synced", syncError: null },
      include: appointmentWriteInclude,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.salonAppointment.update({
      where: { id: existing.id },
      data: { status: "sync_error", syncError: message },
    });
    throw new Error(message);
  }
}

export async function cancelAppointmentFromKresco(appointmentId: string) {
  const existing = await prisma.salonAppointment.findUnique({ where: { id: appointmentId } });
  if (!existing) throw new Error("Запис не знайдено");
  if (existing.altegioRecordId && existing.altegioRecordId > 0) {
    try {
      await deleteAltegioRecord(existing.altegioRecordId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.salonAppointment.update({
        where: { id: existing.id },
        data: { status: "sync_error", syncError: message },
      });
      throw new Error(message);
    }
  }
  return prisma.salonAppointment.update({
    where: { id: existing.id },
    data: { status: "deleted", syncError: null, source: "kresco" },
  });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** З 1-го числа поточного місяця (Kyiv) і далеко вперед — усі живі записи, без стелі +7 днів. */
export function journalAltegioSyncRange(todayYmd = kyivCalendarTodayYmd()): { startDate: string; endDate: string } {
  const startDate = `${String(todayYmd).slice(0, 7)}-01`;
  const [y, m] = String(todayYmd).split("-").map(Number);
  const end = new Date(Date.UTC(y, (m || 1) - 1 + 36 + 1, 0, 12));
  const endDate = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  return { startDate, endDate };
}

export async function syncJournalAppointmentsFromAltegio() {
  const range = journalAltegioSyncRange();
  const result = await syncAppointmentsRangeFromAltegio(range);
  return { ...range, ...result };
}

export async function syncAppointmentsRangeFromAltegio(params: { startDate: string; endDate: string }) {
  const { fetchAllRecordsForLocation } = await import("@/lib/altegio/records");
  const { resolveJournalCompanyId } = await import("./company-id");
  clearJournalAltegioClientCache();
  const companyId = resolveJournalCompanyId();
  const records = await fetchAllRecordsForLocation(companyId, {
    startDate: params.startDate,
    endDate: params.endDate,
    countPerPage: 100,
    delayMs: 150,
  });
  let upserted = 0;
  for (const rec of records) {
    const recordId = Number(rec.record_id ?? rec.id) || 0;
    if (!(recordId > 0)) continue;
    await upsertSalonAppointmentFromAltegio({
      status: rec.deleted ? "delete" : "update",
      deleted: Boolean(rec.deleted),
      altegioRecordId: recordId,
      altegioVisitId: rec.visit_id,
      altegioClientId: Number((rec as any).client_id ?? (rec as any).client?.id) || null,
      altegioStaffId: rec.staff_id ?? null,
      staffName: rec.staff_name ?? null,
      datetime: rec.date,
      seanceLength: rec.seance_length ?? undefined,
      attendance: rec.attendance,
      comment: (rec as any).comment || null,
      clientName: rec.client_name ?? null,
      clientPhone: rec.client_phone ?? null,
      services: rec.services,
    });
    upserted += 1;
  }
  console.log(`[journal] Sync Altegio ${params.startDate}…${params.endDate}: ${upserted} записів`);
  return { count: records.length, upserted };
}
