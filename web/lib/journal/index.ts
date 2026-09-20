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
import { appendAppointmentChangeLog } from "./change-log";
import { replaceAppointmentGoods, replaceAppointmentParticipants } from "./participants";
import { linePayable, serializeStaffIds } from "./line-staff";

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
  const paths = [`/client/${companyId}/${clientId}`, `/clients/${companyId}/${clientId}`, `/company/${companyId}/clients/${clientId}`];
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
  const paths = [
    `/record/${companyId}/${recordId}`,
    `/records/${companyId}/${recordId}`,
    `/records/${recordId}`,
    `/company/${companyId}/records/${recordId}`,
  ];
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

function isBlankClientName(name: string | null | undefined): boolean {
  const s = String(name || "").trim().toLowerCase();
  if (!s) return true;
  return s === "клієнт" || s === "клиент" || s === "client" || s.startsWith("невідом") || s === "unknown";
}

export async function upsertSalonAppointmentFromAltegio(
  input: AltegioAppointmentSyncInput,
  options?: { enrich?: boolean },
) {
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

  if (isBlankClientName(clientName)) clientName = null;

  const enrich = options?.enrich === true;
  if (
    enrich &&
    recordId > 0 &&
    (isBlankClientName(clientName) || !(Number(seanceHint) > 3600) || !datetime)
  ) {
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
      console.log(
        `[journal] Enrich запису ${recordId}: time=${pickAltegioRecordDateTime(full)} seance=${seanceHint} client=${clientName || snap.id || "—"}`,
      );
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
    if (enrich && (isBlankClientName(clientName) || !clientPhone)) {
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
  let seanceLength = normalizeSeanceLength(
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
    clientName: clientName || (isBlankClientName(existing?.clientName) ? null : existing?.clientName) || null,
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
  let catalogDuration = 0;
  const syncStaffIds =
    altegioStaffId && altegioStaffId > 0 ? serializeStaffIds([altegioStaffId]) : null;
  for (const line of lines) {
    const service = await ensureSalonServiceFromLine({
      altegioServiceId: line.altegioServiceId,
      title: line.title,
    });
    catalogDuration += Number(service?.durationSec) || 0;
    await prisma.salonAppointmentLine.create({
      data: {
        appointmentId: appointment.id,
        serviceId: service?.id || null,
        altegioServiceId: line.altegioServiceId,
        title: line.title,
        amount: line.amount,
        cost: line.cost,
        firstCost: line.cost,
        discountPercent: 0,
        staffIdsJson: syncStaffIds,
      },
    });
  }
  if (catalogDuration > seanceLength) {
    seanceLength = catalogDuration;
    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: { seanceLength },
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
      goodLines: true,
      participants: { orderBy: { sortOrder: "asc" } },
      checkout: { include: { payments: true } },
      directClient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          altegioClientId: true,
          phone: true,
          spent: true,
          visits: true,
          lastVisitAt: true,
        },
      },
      master: { select: { id: true, name: true, altegioStaffId: true } },
    },
    orderBy: { datetime: "asc" },
  });
}

const appointmentWriteInclude = {
  lines: true,
  goodLines: true,
  participants: { orderBy: { sortOrder: "asc" as const } },
  changeLogs: { orderBy: { at: "desc" as const }, take: 30 },
  checkout: { include: { payments: true, goodLines: true } },
  directClient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
      altegioClientId: true,
      phone: true,
      spent: true,
      visits: true,
      lastVisitAt: true,
    },
  },
  master: { select: { id: true, name: true, altegioStaffId: true } },
} as const;

export async function getSalonAppointment(id: string) {
  return prisma.salonAppointment.findUnique({
    where: { id },
    include: appointmentWriteInclude,
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

export type KrescoServiceLineInput = {
  serviceId: string;
  amount?: number;
  /** Базова ціна за од. до знижки */
  firstCost?: number;
  discountPercent?: number;
  /** Підсумкова сума; якщо не передано — рахуємо з firstCost/amount/discount */
  cost?: number;
  staffIds?: number[];
};

export type KrescoAppointmentInput = {
  appointmentId?: string;
  directClientId: string;
  masterId: string;
  datetime: string;
  seanceLength?: number;
  comment?: string;
  attendance?: number;
  serviceIds: string[];
  /** Деталі рядків послуг (ціна/знижка/виконавці). Якщо немає — лише serviceIds з дефолтами. */
  serviceLines?: KrescoServiceLineInput[];
  /** Учасники команди запису; max 5 */
  participants?: Array<{
    altegioStaffId: number;
    staffName?: string | null;
    role?: string | null;
    isPrimary?: boolean;
  }>;
  goods?: Array<{
    productId: string;
    storageId: string;
    title?: string;
    quantity?: number;
    salePrice?: number;
    altegioGoodId?: number | null;
    staffIds?: number[];
  }>;
  actor?: string | null;
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

  const fromLines = (input.serviceLines || []).map((l) => String(l.serviceId || "")).filter(Boolean);
  const serviceIds = [...new Set((fromLines.length > 0 ? fromLines : input.serviceIds).filter(Boolean))];
  if (serviceIds.length === 0) throw new Error("Оберіть послугу");
  const services = await prisma.salonService.findMany({ where: { id: { in: serviceIds }, isActive: true } });
  if (services.length === 0) throw new Error("Послуги не знайдено. Імпортуйте довідник з Altegio.");
  const byId = new Map(services.map((s) => [s.id, s]));
  // Зберігаємо порядок з форми
  const orderedServices = serviceIds.map((id) => byId.get(id)).filter(Boolean) as typeof services;
  const datetime = parseKyivWallClock(input.datetime);
  if (!datetime) throw new Error("Вкажіть дату і час запису");
  const seanceLength =
    Number(input.seanceLength) > 0
      ? Number(input.seanceLength)
      : Math.max(...orderedServices.map((s) => s.durationSec || 3600), 3600);
  return { client, directMasterId, altegioStaffId, staffName, services: orderedServices, datetime, seanceLength };
}

function buildServiceLineRows(
  appointmentId: string,
  services: Array<{ id: string; title: string; altegioServiceId: number }>,
  input: KrescoAppointmentInput,
  defaultStaffIds: number[],
) {
  const detailByService = new Map<string, KrescoServiceLineInput>();
  for (const line of input.serviceLines || []) {
    if (line.serviceId) detailByService.set(String(line.serviceId), line);
  }
  return services.map((s) => {
    const detail = detailByService.get(s.id);
    const amount = Math.max(0.001, Number(detail?.amount) || 1);
    const discountPercent = Math.min(100, Math.max(0, Number(detail?.discountPercent) || 0));
    const firstCost = Math.max(
      0,
      detail?.firstCost != null
        ? Number(detail.firstCost) || 0
        : Number(detail?.cost) || 0,
    );
    const cost = linePayable(firstCost, amount, discountPercent);
    const staffIds = Array.isArray(detail?.staffIds)
      ? detail!.staffIds!.map(Number).filter((id) => id > 0)
      : [...defaultStaffIds];
    if (staffIds.length === 0) {
      throw new Error(`У послузі «${s.title}» має бути хоча б один виконавець`);
    }
    return {
      appointmentId,
      serviceId: s.id,
      altegioServiceId: s.altegioServiceId,
      title: s.title,
      amount,
      cost,
      firstCost,
      discountPercent,
      staffIdsJson: serializeStaffIds(staffIds),
    };
  });
}

async function applyCardExtras(
  appointmentId: string,
  input: KrescoAppointmentInput,
  ctx: {
    altegioStaffId: number;
    staffName: string;
    services: Array<{ id: string; title: string }>;
  },
  kind: "create" | "update",
) {
  const participantInputs =
    input.participants && input.participants.length > 0
      ? input.participants
      : [
          {
            altegioStaffId: ctx.altegioStaffId,
            staffName: ctx.staffName,
            role: "master",
            isPrimary: true,
          },
        ];

  // Гарантуємо, що primary = masterId з форми
  const normalized = participantInputs.map((p) => ({
    ...p,
    isPrimary: Number(p.altegioStaffId) === ctx.altegioStaffId,
  }));
  if (!normalized.some((p) => p.isPrimary)) {
    normalized.unshift({
      altegioStaffId: ctx.altegioStaffId,
      staffName: ctx.staffName,
      role: "master",
      isPrimary: true,
    });
  }

  await replaceAppointmentParticipants(appointmentId, normalized);

  // Якщо товари передані — кожен рядок повинен мати виконавців (валідація в replaceAppointmentGoods)
  if (input.goods) {
    const teamIds = normalized.map((p) => Number(p.altegioStaffId)).filter((id) => id > 0);
    const goodsWithStaff = input.goods.map((g) => ({
      ...g,
      staffIds:
        Array.isArray(g.staffIds) && g.staffIds.length > 0
          ? g.staffIds
          : teamIds.length > 0
            ? teamIds
            : [ctx.altegioStaffId],
    }));
    await replaceAppointmentGoods(appointmentId, goodsWithStaff);
  }

  await appendAppointmentChangeLog({
    appointmentId,
    action: kind,
    actor: input.actor || null,
    summary:
      kind === "create"
        ? `Створено запис · ${ctx.services.map((s) => s.title).join(", ") || "без послуг"}`
        : `Оновлено запис · статус/послуги/учасники`,
    after: {
      attendance: input.attendance,
      serviceIds: input.serviceIds,
      participants: normalized.map((p) => p.altegioStaffId),
      goods: (input.goods || []).length,
    },
  });
}

export async function createAppointmentFromKresco(input: KrescoAppointmentInput) {
  const ctx = await loadWriteContext(input);
  const kyivDay = kyivYmdFromDateTimeInput(ctx.datetime) || "";
  const snap = snapshotFromDirectClient(ctx.client);
  const defaultStaffIds = (() => {
    const fromParticipants = (input.participants || [])
      .map((p) => Number(p.altegioStaffId))
      .filter((id) => id > 0);
    if (fromParticipants.length > 0) return fromParticipants;
    return ctx.altegioStaffId > 0 ? [ctx.altegioStaffId] : [];
  })();
  const lineRows = buildServiceLineRows("pending", ctx.services, input, defaultStaffIds).map(
    ({ appointmentId: _a, ...rest }) => rest,
  );

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
        create: lineRows,
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
      services: lineRows.map((l) => ({
        id: l.altegioServiceId,
        amount: l.amount,
        firstCost: l.firstCost,
        cost: l.cost,
      })),
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
    await applyCardExtras(saved.id, input, ctx, "create");
    return prisma.salonAppointment.findUniqueOrThrow({
      where: { id: saved.id },
      include: appointmentWriteInclude,
    });
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
    await applyCardExtras(saved.id, input, ctx, "create");
    return prisma.salonAppointment.findUniqueOrThrow({
      where: { id: saved.id },
      include: appointmentWriteInclude,
    });
  } catch (saveErr) {
    const racedAfter = await prisma.salonAppointment.findUnique({ where: { altegioRecordId: created.id } });
    if (racedAfter && racedAfter.id !== pending.id) {
      await prisma.salonAppointment.delete({ where: { id: pending.id } }).catch(() => undefined);
      const merged = await prisma.salonAppointment.update({
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
      await applyCardExtras(merged.id, input, ctx, "create");
      return prisma.salonAppointment.findUniqueOrThrow({
        where: { id: merged.id },
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
  const defaultStaffIds = (() => {
    const fromParticipants = (input.participants || [])
      .map((p) => Number(p.altegioStaffId))
      .filter((id) => id > 0);
    if (fromParticipants.length > 0) return fromParticipants;
    return ctx.altegioStaffId > 0 ? [ctx.altegioStaffId] : [];
  })();
  const lineRows = buildServiceLineRows(existing.id, ctx.services, input, defaultStaffIds);
  await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: existing.id } });
  await prisma.salonAppointmentLine.createMany({ data: lineRows });

  try {
    await updateAltegioRecord(existing.altegioRecordId, {
      staffId: ctx.altegioStaffId,
      clientId: ctx.client.altegioClientId as number,
      datetime: formatKyivDateTime(ctx.datetime),
      seanceLength: ctx.seanceLength,
      comment: input.comment || "",
      attendance: input.attendance ?? existing.attendance ?? 0,
      services: lineRows.map((l) => ({
        id: l.altegioServiceId as number,
        amount: l.amount,
        firstCost: l.firstCost,
        cost: l.cost,
      })),
    });
    await applyCardExtras(existing.id, input, ctx, "update");
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

export async function cancelAppointmentFromKresco(appointmentId: string, actor?: string | null) {
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
  const deleted = await prisma.salonAppointment.update({
    where: { id: existing.id },
    data: { status: "deleted", syncError: null, source: "kresco" },
  });
  await appendAppointmentChangeLog({
    appointmentId,
    action: "cancel",
    actor: actor || null,
    summary: "Скасовано запис",
  });
  return deleted;
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

export async function syncAppointmentsRangeFromAltegio(params: {
  startDate: string;
  endDate: string;
  enrich?: boolean;
}) {
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
    if (upserted === 0) {
      console.log("[journal] Перший запис Altegio для синку:", {
        recordId,
        date: rec.date,
        seance_length: rec.seance_length,
        client_name: rec.client_name,
        client_id: (rec as any).client_id,
        services: (rec.services || []).map((s) => ({ title: s.title || s.name, duration: s.duration })),
      });
    }
    await upsertSalonAppointmentFromAltegio(
      {
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
      },
      { enrich: params.enrich === true },
    );
    if (params.enrich === true || params.startDate === params.endDate) {
      try {
        const appt = await prisma.salonAppointment.findUnique({
          where: { altegioRecordId: recordId },
          select: { id: true, kyivDay: true, altegioVisitId: true },
        });
        if (appt) {
          const { upsertCheckoutFromAltegioPayments } = await import("./checkout");
          await upsertCheckoutFromAltegioPayments({
            appointmentId: appt.id,
            altegioRecordId: recordId,
            altegioVisitId: Number(rec.visit_id) || appt.altegioVisitId,
            kyivDay: appt.kyivDay,
          });
        }
      } catch (checkoutErr) {
        console.warn(
          `[journal] Checkout sync для record=${recordId}:`,
          checkoutErr instanceof Error ? checkoutErr.message : checkoutErr,
        );
      }
    }
    upserted += 1;
  }
  if (params.startDate === params.endDate) {
    await fillMissingClientsFromVisit(params.startDate);
  }
  console.log(
    `[journal] Sync Altegio ${params.startDate}…${params.endDate}: ${upserted} записів enrich=${params.enrich === true}`,
  );
  return { count: records.length, upserted };
}

async function fillMissingClientsFromVisit(kyivDay: string) {
  const rows = await prisma.salonAppointment.findMany({
    where: { kyivDay, status: { not: "deleted" } },
    select: {
      id: true,
      altegioVisitId: true,
      clientName: true,
      clientPhone: true,
      altegioClientId: true,
    },
  });
  const byVisit = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!(row.altegioVisitId && row.altegioVisitId > 0)) continue;
    const list = byVisit.get(row.altegioVisitId) || [];
    list.push(row);
    byVisit.set(row.altegioVisitId, list);
  }
  for (const group of byVisit.values()) {
    const donor = group.find((r) => !isBlankClientName(r.clientName));
    if (!donor) continue;
    for (const row of group) {
      if (row.id === donor.id) continue;
      const needName = isBlankClientName(row.clientName);
      const needPhone = !row.clientPhone;
      if (!needName && !needPhone && row.altegioClientId) continue;
      await prisma.salonAppointment.update({
        where: { id: row.id },
        data: {
          clientName: needName ? donor.clientName : row.clientName,
          clientPhone: needPhone ? donor.clientPhone : row.clientPhone,
          altegioClientId: row.altegioClientId || donor.altegioClientId,
        },
      });
      console.log(`[journal] ПІБ з візиту ${donor.altegioVisitId} скопійовано на запис ${row.id}`);
    }
  }
}
