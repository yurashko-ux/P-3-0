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
import { ensureSalonServiceFromLine, resolveAltegioServiceIdForWrite } from "./services";
import { listJournalStaff, hasAssignedPosition } from "./staff";
import { resolveJournalCompanyId } from "./company-id";
import { appendAppointmentChangeLog } from "./change-log";
import { replaceAppointmentGoods, replaceAppointmentParticipants } from "./participants";
import { linePayable, serializeStaffIds } from "./line-staff";
import {
  isConsultationServiceKind,
  isJournalAltegioImportEnabled,
  shouldWriteJournalAppointmentToAltegio,
} from "./altegio-write-gate";
import { isKrescoRecordNumberConflict, nextKrescoRecordNumber } from "./kresco-record-number";
import { ensureAltegioClientId } from "@/lib/altegio/clients-write";

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

/** Той самий набір послуг Altegio, що й у запису Kresco? Тоді рядки Kresco (виконавці, знижки) не чіпаємо. */
async function krescoLinesMatchAltegio(
  appointmentId: string,
  incoming: Array<{ altegioServiceId: number | null }>,
): Promise<boolean> {
  const rows = await prisma.salonAppointmentLine.findMany({
    where: { appointmentId },
    select: { altegioServiceId: true },
  });
  if (rows.length === 0) return false;
  const ids = (list: Array<{ altegioServiceId: number | null }>) =>
    list
      .map((l) => Number(l.altegioServiceId) || 0)
      .filter((id) => id > 0)
      .sort((a, b) => a - b)
      .join(",");
  return ids(rows) === ids(incoming);
}

/** Вебхук випередив Kresco: переносимо рядки чернетки у запис, створений вебхуком. */
async function moveLinesToRacedAppointment(pendingId: string, racedId: string) {
  const moved = await prisma.salonAppointmentLine.count({ where: { appointmentId: pendingId } });
  if (moved === 0) return;
  await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: racedId } });
  await prisma.salonAppointmentLine.updateMany({
    where: { appointmentId: pendingId },
    data: { appointmentId: racedId },
  });
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
  if (!isJournalAltegioImportEnabled()) {
    console.log(`[journal] Імпорт з Altegio вимкнено — запис ${input.altegioRecordId} пропущено`);
    return null;
  }
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
  const existingLineCosts = await prisma.salonAppointmentLine.findMany({
    where: { appointment: { altegioRecordId: recordId } },
    select: { altegioServiceId: true, cost: true },
  });
  // Список записів Altegio не віддає цін: не затираємо суму, уже взяту з картки запису.
  const lines = normalizeLines(servicesForLines).map((line) => ({
    ...line,
    cost:
      line.cost ||
      existingLineCosts.find((l) => l.altegioServiceId === line.altegioServiceId)?.cost ||
      0,
  }));
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

  const keepKrescoLines =
    existing?.source === "kresco" && (await krescoLinesMatchAltegio(appointment.id, lines));
  if (keepKrescoLines) {
    console.log(`[journal] Запис Altegio ${recordId}: послуги ті самі — рядки Kresco збережено`);
  } else {
    await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: appointment.id } });
  }
  let catalogDuration = 0;
  const syncStaffIds =
    altegioStaffId && altegioStaffId > 0 ? serializeStaffIds([altegioStaffId]) : null;
  for (const line of keepKrescoLines ? [] : lines) {
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

async function ensureDirectClientLinkedToAltegio<
  T extends {
    id: string;
    altegioClientId: number | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string | null;
  },
>(client: T): Promise<T> {
  if (client.altegioClientId && client.altegioClientId > 0) return client;
  const phone = String(client.phone || "").trim();
  if (!phone) {
    throw new Error("Для запису консультації в Altegio потрібен телефон клієнта в Direct");
  }
  const name =
    [client.lastName, client.firstName].filter(Boolean).join(" ").trim() ||
    String(client.instagramUsername || "").replace(/^@/, "").trim() ||
    "Клієнт";
  const { altegioClientId, created } = await ensureAltegioClientId({ name, phone });
  await prisma.directClient.update({
    where: { id: client.id },
    data: { altegioClientId },
  });
  console.log(
    `[journal] Клієнт Direct ${client.id} → Altegio ${altegioClientId} (${created ? "створено" : "знайдено за телефоном"})`,
  );
  return { ...client, altegioClientId };
}

function servicesIncludeConsultation(
  services: Array<{ kind?: string | null; title?: string | null }>,
): boolean {
  return services.some(
    (s) => isConsultationServiceKind(s.kind) || /консультаці/i.test(String(s.title || "")),
  );
}

async function appointmentLinesAreConsultation(
  lines: Array<{ serviceId?: string | null; title?: string | null }>,
): Promise<boolean> {
  if (lines.some((l) => /консультаці/i.test(String(l.title || "")))) return true;
  const serviceIds = [...new Set(lines.map((l) => String(l.serviceId || "")).filter(Boolean))];
  if (serviceIds.length === 0) return false;
  const services = await prisma.salonService.findMany({
    where: { id: { in: serviceIds } },
    select: { kind: true, title: true },
  });
  return servicesIncludeConsultation(services);
}

/** Запис має вміститись у зміну працівника (графік Kresco). Немає рядка графіка на день — не блокуємо. */
async function assertWithinWorkShift(
  altegioStaffId: number,
  staffName: string,
  datetime: Date,
  seanceLengthSec: number,
) {
  const startText = formatKyivDateTime(datetime);
  const kyivDay = startText.slice(0, 10);
  const workDay = await prisma.teamWorkDay.findUnique({
    where: { altegioStaffId_kyivDay: { altegioStaffId, kyivDay } },
  });
  if (!workDay) return;
  const slots = (Array.isArray(workDay.slots) ? workDay.slots : []) as Array<{ from?: string; to?: string }>;
  const start = startText.slice(11, 16);
  const endText = formatKyivDateTime(new Date(datetime.getTime() + seanceLengthSec * 1000));
  const end = endText.slice(0, 10) === kyivDay ? endText.slice(11, 16) : "24:00";
  const [y, mo, d] = kyivDay.split("-");
  if (slots.length === 0) {
    console.warn(`[journal] Відхилено запис: ${staffName} не працює ${kyivDay}`);
    throw new Error(`Цей час недоступний: ${staffName} не працює ${d}.${mo}.${y}. Оберіть інший день.`);
  }
  const fits = slots.some((s) => s.from && s.to && start >= s.from && end <= s.to);
  if (fits) return;
  const shifts = slots.map((s) => `${s.from}–${s.to}`).join(", ");
  console.warn(`[journal] Відхилено запис поза зміною: ${staffName} ${kyivDay} ${start}–${end}, зміна ${shifts}`);
  throw new Error(
    `Цей час недоступний: ${staffName} ${d}.${mo}.${y} працює ${shifts}, а запис ${start}–${end}. Оберіть час у межах зміни.`,
  );
}

/** Altegio 409 «The selected time is not available» → зрозуміле повідомлення. */
function readableAltegioWriteError(message: string): string {
  if (/HTTP 409/.test(message) && /time is not available/i.test(message)) {
    return "Цей час недоступний в Altegio: працівник не працює в цей час або час зайнятий. Оберіть інший час.";
  }
  return message;
}

async function loadWriteContext(input: KrescoAppointmentInput, opts?: { isCreate?: boolean }) {
  let client = await prisma.directClient.findUnique({ where: { id: input.directClientId } });
  if (!client) throw new Error("Клієнта Direct не знайдено");

  const staffList = await listJournalStaff();
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
    throw new Error("Працівника немає в актуальному штаті з посадою");
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
  if (services.length === 0) throw new Error("Послуги не знайдено. Відкрийте довідник послуг журналу.");
  const byId = new Map(services.map((s) => [s.id, s]));
  // Зберігаємо порядок з форми
  const orderedServices = serviceIds.map((id) => byId.get(id)).filter(Boolean) as typeof services;
  const datetime = parseKyivWallClock(input.datetime);
  if (!datetime) throw new Error("Вкажіть дату і час запису");
  const seanceLength =
    Number(input.seanceLength) > 0
      ? Number(input.seanceLength)
      : // Тривалість з довідника послуг, але не менше 30 хв; послуга без тривалості — година
        Math.max(...orderedServices.map((s) => s.durationSec || 3600), 1800);

  const isConsultation = servicesIncludeConsultation(orderedServices);
  // Нова консультація в минулому: Altegio відповідає 409 «time is not available».
  // Зупиняємо до створення запису в Kresco і до будь-яких викликів Altegio, щоб не лишати sync_error.
  if (opts?.isCreate && isConsultation && datetime.getTime() < Date.now()) {
    console.warn(
      `[journal] Відхилено створення консультації в минулому: ${formatKyivDateTime(datetime)} (зараз ${formatKyivDateTime(new Date())})`,
    );
    const [ymd, hm] = formatKyivDateTime(datetime).slice(0, 16).split(" ");
    const [y, mo, d] = ymd.split("-");
    throw new Error(
      `Цей час недоступний — він уже минув (${d}.${mo}.${y} ${hm}). Оберіть майбутній час для консультації.`,
    );
  }
  const writeAltegio = shouldWriteJournalAppointmentToAltegio({ isConsultation });
  // Час поза зміною працівника: Altegio відповідає 409 «time is not available».
  // Перевіряємо за графіком Kresco до створення запису, щоб дати зрозуміле повідомлення.
  if (opts?.isCreate && writeAltegio) {
    await assertWithinWorkShift(altegioStaffId, staffName, datetime, seanceLength);
  }
  if (writeAltegio) {
    client = await ensureDirectClientLinkedToAltegio(client);
  }

  return {
    client,
    directMasterId,
    altegioStaffId,
    staffName,
    services: orderedServices,
    datetime,
    seanceLength,
    isConsultation,
    writeAltegio,
  };
}

async function buildServiceLineRows(
  appointmentId: string,
  services: Array<{ id: string; title: string; source?: string | null }>,
  input: KrescoAppointmentInput,
  defaultStaffIds: number[],
) {
  const detailByService = new Map<string, KrescoServiceLineInput>();
  for (const line of input.serviceLines || []) {
    if (line.serviceId) detailByService.set(String(line.serviceId), line);
  }
  const rows = [];
  for (const s of services) {
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
    // Kresco-only: без Altegio id. Mapped: default з таблиці мапінгу. Виняток — ALTEGIO_WRITE_AS.
    const altegioServiceId = await resolveAltegioServiceIdForWrite(s);
    rows.push({
      appointmentId,
      serviceId: s.id,
      altegioServiceId,
      title: s.title,
      amount,
      cost,
      firstCost,
      discountPercent,
      staffIdsJson: serializeStaffIds(staffIds),
    });
  }
  return rows;
}

function altegioServicesPayload(
  lineRows: Array<{ altegioServiceId: number | null; amount: number; firstCost: number; cost: number }>,
) {
  return lineRows
    .filter((l) => l.altegioServiceId && l.altegioServiceId > 0)
    .map((l) => ({
      id: l.altegioServiceId as number,
      amount: l.amount,
      firstCost: l.firstCost,
      cost: l.cost,
    }));
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
  const ctx = await loadWriteContext(input, { isCreate: true });
  const kyivDay = kyivYmdFromDateTimeInput(ctx.datetime) || "";
  const snap = snapshotFromDirectClient(ctx.client);
  const defaultStaffIds = (() => {
    const fromParticipants = (input.participants || [])
      .map((p) => Number(p.altegioStaffId))
      .filter((id) => id > 0);
    if (fromParticipants.length > 0) return fromParticipants;
    return ctx.altegioStaffId > 0 ? [ctx.altegioStaffId] : [];
  })();
  const built = await buildServiceLineRows("pending", ctx.services, input, defaultStaffIds);
  const lineRows = built.map(({ appointmentId: _a, ...rest }) => rest);

  const pendingData = {
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
    status: "pending" as const,
    source: "kresco",
    kyivDay,
    lines: {
      create: lineRows,
    },
  };
  let pending: Awaited<ReturnType<typeof prisma.salonAppointment.create>> | null = null;
  for (let attempt = 0; attempt < 5 && !pending; attempt += 1) {
    try {
      pending = await prisma.salonAppointment.create({
        data: { ...pendingData, krescoRecordNumber: await nextKrescoRecordNumber() },
      });
    } catch (err) {
      if (!isKrescoRecordNumberConflict(err) || attempt === 4) throw err;
    }
  }
  if (!pending) throw new Error("Не вдалося пронумерувати запис Kresco");

  let created: { id: number; visitId: number | null };

  if (!ctx.writeAltegio) {
    console.log(
      `[journal] Dual-write вимкнено для цього запису ${pending.id} (consult=${ctx.isConsultation}) — лише Kresco`,
    );
    await applyCardExtras(pending.id, input, ctx, "create");
    return prisma.salonAppointment.update({
      where: { id: pending.id },
      data: {
        status: "synced",
        syncError: ctx.isConsultation
          ? "консультації в Altegio вимкнено (JOURNAL_ALTEGIO_WRITE_CONSULTATIONS)"
          : "тест: без запису в Altegio (не консультація)",
      },
      include: appointmentWriteInclude,
    });
  }

  const altegioServices = altegioServicesPayload(lineRows);
  if (altegioServices.length === 0) {
    console.log(
      `[journal] Запис ${pending.id}: усі послуги лише Kresco — dual-write послуг у Altegio пропущено`,
    );
    await applyCardExtras(pending.id, input, ctx, "create");
    return prisma.salonAppointment.update({
      where: { id: pending.id },
      data: {
        status: "synced",
        syncError: "лише Kresco-послуги (без Altegio id)",
      },
      include: appointmentWriteInclude,
    });
  }

  try {
    created = await createAltegioRecord({
      staffId: ctx.altegioStaffId,
      clientId: ctx.client.altegioClientId as number,
      datetime: formatKyivDateTime(ctx.datetime),
      seanceLength: ctx.seanceLength,
      comment: input.comment || "",
      attendance: input.attendance ?? 0,
      services: altegioServices,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const readable = readableAltegioWriteError(message);
    if (readable !== message) {
      // Altegio відмовив за часом — запису немає ніде, тож не лишаємо sync_error у журналі
      await prisma.salonAppointment.delete({ where: { id: pending.id } }).catch(() => undefined);
      console.warn(`[journal] Altegio відхилив час запису ${pending.id}, чернетку видалено:`, message);
      throw new Error(readable);
    }
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
    await moveLinesToRacedAppointment(pending.id, raced.id);
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
        krescoRecordNumber: pending.krescoRecordNumber,
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
      await moveLinesToRacedAppointment(pending.id, racedAfter.id);
      await prisma.salonAppointment.delete({ where: { id: pending.id } }).catch(() => undefined);
      const merged = await prisma.salonAppointment.update({
        where: { id: racedAfter.id },
        data: {
          status: "synced",
          syncError: null,
          source: "kresco",
          directClientId: ctx.client.id,
          masterId: ctx.directMasterId,
          krescoRecordNumber: pending.krescoRecordNumber,
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
  const ctx = await loadWriteContext(input);
  const hasAltegioRecord = Boolean(existing.altegioRecordId && existing.altegioRecordId > 0);
  const skipAltegio = !ctx.writeAltegio || !hasAltegioRecord;
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
      status: skipAltegio ? "synced" : "pending",
      syncError: skipAltegio
        ? hasAltegioRecord
          ? "dual-write вимкнено для цього типу запису"
          : "немає id запису Altegio"
        : null,
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
  const lineRows = await buildServiceLineRows(existing.id, ctx.services, input, defaultStaffIds);
  await prisma.salonAppointmentLine.deleteMany({ where: { appointmentId: existing.id } });
  await prisma.salonAppointmentLine.createMany({ data: lineRows });

  if (skipAltegio) {
    console.log(
      `[journal] Оновлення ${existing.id} лише в Kresco (writeAltegio=${ctx.writeAltegio}, altegioRecordId=${existing.altegioRecordId || "—"})`,
    );
    await applyCardExtras(existing.id, input, ctx, "update");
    return prisma.salonAppointment.findUniqueOrThrow({
      where: { id: existing.id },
      include: appointmentWriteInclude,
    });
  }

  const altegioServices = altegioServicesPayload(lineRows);
  if (altegioServices.length === 0) {
    console.log(
      `[journal] Оновлення ${existing.id}: лише Kresco-послуги — services у Altegio не оновлюємо`,
    );
    await applyCardExtras(existing.id, input, ctx, "update");
    return prisma.salonAppointment.update({
      where: { id: existing.id },
      data: { status: "synced", syncError: "лише Kresco-послуги (без Altegio id)" },
      include: appointmentWriteInclude,
    });
  }

  try {
    await updateAltegioRecord(existing.altegioRecordId!, {
      staffId: ctx.altegioStaffId,
      clientId: ctx.client.altegioClientId as number,
      datetime: formatKyivDateTime(ctx.datetime),
      seanceLength: ctx.seanceLength,
      comment: input.comment || "",
      attendance: input.attendance ?? existing.attendance ?? 0,
      services: altegioServices,
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
    throw new Error(readableAltegioWriteError(message));
  }
}

/** Швидка зміна статусу візиту з попапу календаря (без перезапису послуг). */
export async function updateAppointmentAttendanceFromKresco(input: {
  appointmentId: string;
  attendance: number;
  actor?: string | null;
}) {
  const attendance =
    input.attendance === -1 || input.attendance === 0 || input.attendance === 1 || input.attendance === 2
      ? input.attendance
      : null;
  if (attendance === null) throw new Error("Некоректний статус візиту");

  const existing = await prisma.salonAppointment.findUnique({
    where: { id: input.appointmentId },
    include: { lines: true },
  });
  if (!existing || existing.status === "deleted") throw new Error("Запис не знайдено");

  const prev = existing.attendance;
  await prisma.salonAppointment.update({
    where: { id: existing.id },
    data: { attendance, source: "kresco" },
  });

  const isConsultation = await appointmentLinesAreConsultation(existing.lines || []);
  if (
    shouldWriteJournalAppointmentToAltegio({ isConsultation }) &&
    existing.altegioRecordId &&
    existing.altegioRecordId > 0
  ) {
    const staffId = Number(existing.altegioStaffId) || 0;
    const clientId = Number(existing.altegioClientId) || 0;
    const services = (existing.lines || [])
      .filter((l) => l.altegioServiceId && l.altegioServiceId > 0)
      .map((l) => ({
        id: l.altegioServiceId as number,
        amount: l.amount,
        firstCost: l.firstCost,
        cost: l.cost,
      }));
    if (staffId > 0 && clientId > 0 && services.length > 0) {
      try {
        await updateAltegioRecord(existing.altegioRecordId, {
          staffId,
          clientId,
          datetime: formatKyivDateTime(existing.datetime),
          seanceLength: existing.seanceLength,
          comment: existing.comment || "",
          attendance,
          services,
        });
        await prisma.salonAppointment.update({
          where: { id: existing.id },
          data: { status: "synced", syncError: null },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[journal] Не вдалось синхронізувати attendance в Altegio:", message);
        await prisma.salonAppointment.update({
          where: { id: existing.id },
          data: { status: "sync_error", syncError: message },
        });
        // Локально статус уже змінено — не відкочуємо, щоб UI реагував одразу.
      }
    }
  }

  if (prev !== attendance) {
    await appendAppointmentChangeLog({
      appointmentId: existing.id,
      actor: input.actor || null,
      action: "attendance",
      summary: `Статус візиту: ${prev} → ${attendance}`,
      before: { attendance: prev },
      after: { attendance },
    });
  }

  return getSalonAppointment(existing.id);
}

export async function cancelAppointmentFromKresco(appointmentId: string, actor?: string | null) {
  const existing = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    include: { lines: true },
  });
  if (!existing) throw new Error("Запис не знайдено");
  const isConsultation = await appointmentLinesAreConsultation(existing.lines || []);
  if (
    shouldWriteJournalAppointmentToAltegio({ isConsultation }) &&
    existing.altegioRecordId &&
    existing.altegioRecordId > 0
  ) {
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

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Повний діапазон: з 1-го числа місяця (Kyiv) на ~36 міс уперед. Лише нічний повний синк. */
export function journalAltegioSyncRange(todayYmd = kyivCalendarTodayYmd()): { startDate: string; endDate: string } {
  const startDate = `${String(todayYmd).slice(0, 7)}-01`;
  const [y, m] = String(todayYmd).split("-").map(Number);
  const end = new Date(Date.UTC(y, (m || 1) - 1 + 36 + 1, 0, 12));
  const endDate = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  return { startDate, endDate };
}

/** Вузьке вікно для щогодинного cron: сьогодні −3 … +90 днів (Kyiv). */
export function journalAltegioSyncRangeRecent(
  todayYmd = kyivCalendarTodayYmd(),
): { startDate: string; endDate: string } {
  return {
    startDate: shiftYmd(todayYmd, -3),
    endDate: shiftYmd(todayYmd, 90),
  };
}

/**
 * Як у фінансах: повний діапазон раз на добу (00:00–00:30 UTC),
 * решту часу — лише recent-вікно (менше запитів до Prisma).
 */
export function resolveJournalAltegioSyncRange(
  now: Date = new Date(),
  todayYmd = kyivCalendarTodayYmd(),
): { startDate: string; endDate: string; mode: "full" | "recent" } {
  const isNightlyFullSync = now.getUTCHours() === 0 && now.getUTCMinutes() < 30;
  if (isNightlyFullSync) {
    return { ...journalAltegioSyncRange(todayYmd), mode: "full" };
  }
  return { ...journalAltegioSyncRangeRecent(todayYmd), mode: "recent" };
}

type JournalExistingSnap = {
  id: string;
  status: string;
  datetime: Date;
  seanceLength: number;
  attendance: number | null;
  altegioStaffId: number | null;
  altegioClientId: number | null;
  altegioVisitId: number | null;
  comment: string | null;
  clientName: string | null;
  clientPhone: string | null;
  lines: Array<{
    altegioServiceId: number | null;
    title: string;
    amount: number;
    cost: number;
  }>;
};

/** Знімок для порівняння Altegio ↔ БД без зайвих upsert. */
function journalSyncFingerprint(input: {
  deleted: boolean;
  datetimeIso: string | null;
  seanceLength: number;
  attendance: number | null;
  altegioStaffId: number | null;
  altegioClientId: number | null;
  altegioVisitId: number | null;
  comment: string | null;
  clientName: string | null;
  clientPhone: string | null;
  lines: Array<{ altegioServiceId: number | null; title: string; amount: number; cost: number }>;
}): string {
  const linesKey = [...input.lines]
    .map(
      (l) =>
        `${l.altegioServiceId ?? ""}|${l.title}|${Number(l.amount) || 0}|${Number(l.cost) || 0}`,
    )
    .sort()
    .join(";");
  return [
    input.deleted ? "1" : "0",
    input.datetimeIso || "",
    // seance порівнюємо окремо (каталог може збільшити DB-значення)
    String(input.attendance ?? ""),
    String(input.altegioStaffId ?? ""),
    String(input.altegioClientId ?? ""),
    String(input.altegioVisitId ?? ""),
    String(input.comment || "").trim(),
    isBlankClientName(input.clientName) ? "" : String(input.clientName || "").trim(),
    String(input.clientPhone || "").trim(),
    linesKey,
    // seance як підказка; skip якщо DB >= Altegio (див. isUnchanged)
    String(input.seanceLength || 0),
  ].join("\n");
}

function isJournalAppointmentUnchanged(
  existing: JournalExistingSnap,
  incoming: {
    deleted: boolean;
    datetime: Date | null;
    seanceLength: number;
    attendance: number | null;
    altegioStaffId: number | null;
    altegioClientId: number | null;
    altegioVisitId: number | null;
    comment: string | null;
    clientName: string | null;
    clientPhone: string | null;
    lines: Array<{ altegioServiceId: number | null; title: string; amount: number; cost: number }>;
  },
): boolean {
  if (incoming.deleted) {
    return existing.status === "deleted";
  }
  if (existing.status === "deleted") return false;
  if (!incoming.datetime) return false;

  const existingFp = journalSyncFingerprint({
    deleted: false,
    datetimeIso: existing.datetime.toISOString(),
    seanceLength: existing.seanceLength,
    attendance: existing.attendance,
    altegioStaffId: existing.altegioStaffId,
    altegioClientId: existing.altegioClientId,
    altegioVisitId: existing.altegioVisitId,
    comment: existing.comment,
    clientName: existing.clientName,
    clientPhone: existing.clientPhone,
    lines: existing.lines,
  });
  const incomingLines = incoming.lines.map((line) => ({
    ...line,
    cost:
      line.cost ||
      existing.lines.find((l) => l.altegioServiceId === line.altegioServiceId)?.cost ||
      0,
  }));
  const incomingFp = journalSyncFingerprint({
    deleted: false,
    datetimeIso: incoming.datetime.toISOString(),
    seanceLength: incoming.seanceLength,
    attendance: incoming.attendance,
    altegioStaffId: incoming.altegioStaffId,
    altegioClientId: incoming.altegioClientId,
    altegioVisitId: incoming.altegioVisitId,
    comment: incoming.comment,
    clientName: incoming.clientName,
    clientPhone: incoming.clientPhone,
    lines: incomingLines,
  });

  // seanceLength у fingerprint — якщо відрізняється лише seance і DB >= Altegio (каталог), вважаємо ок
  const stripSeance = (fp: string) => fp.replace(/\n\d+$/, "\n*");
  if (stripSeance(existingFp) !== stripSeance(incomingFp)) return false;
  if (existing.seanceLength === incoming.seanceLength) return true;
  // upsert може підняти seance до суми тривалостей послуг з каталогу
  return existing.seanceLength >= incoming.seanceLength;
}

export async function syncJournalAppointmentsFromAltegio(options?: { full?: boolean }) {
  const range =
    options?.full === true
      ? { ...journalAltegioSyncRange(), mode: "full" as const }
      : resolveJournalAltegioSyncRange();
  const result = await syncAppointmentsRangeFromAltegio(range);
  return { ...range, ...result };
}

export async function syncAppointmentsRangeFromAltegio(params: {
  startDate: string;
  endDate: string;
  enrich?: boolean;
  mode?: "full" | "recent";
}) {
  if (!isJournalAltegioImportEnabled()) {
    console.log(`[journal] Імпорт з Altegio вимкнено — синк ${params.startDate}…${params.endDate} пропущено`);
    return { count: 0, upserted: 0, skipped: 0, importDisabled: true };
  }
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

  const recordIds = records
    .map((rec) => Number(rec.record_id ?? rec.id) || 0)
    .filter((id) => id > 0);
  const existingByRecordId = new Map<number, JournalExistingSnap>();
  const CHUNK = 400;
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    const chunk = recordIds.slice(i, i + CHUNK);
    const rows = await prisma.salonAppointment.findMany({
      where: { altegioRecordId: { in: chunk } },
      select: {
        id: true,
        status: true,
        datetime: true,
        seanceLength: true,
        attendance: true,
        altegioStaffId: true,
        altegioClientId: true,
        altegioVisitId: true,
        comment: true,
        clientName: true,
        clientPhone: true,
        altegioRecordId: true,
        lines: {
          select: {
            altegioServiceId: true,
            title: true,
            amount: true,
            cost: true,
          },
        },
      },
    });
    for (const row of rows) {
      if (!(row.altegioRecordId && row.altegioRecordId > 0)) continue;
      existingByRecordId.set(row.altegioRecordId, {
        id: row.id,
        status: row.status,
        datetime: row.datetime,
        seanceLength: row.seanceLength,
        attendance: row.attendance,
        altegioStaffId: row.altegioStaffId,
        altegioClientId: row.altegioClientId,
        altegioVisitId: row.altegioVisitId,
        comment: row.comment,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        lines: row.lines.map((l) => ({
          altegioServiceId: l.altegioServiceId,
          title: l.title,
          amount: l.amount,
          cost: l.cost,
        })),
      });
    }
  }

  let upserted = 0;
  let skipped = 0;
  let loggedFirst = false;
  for (const rec of records) {
    const recordId = Number(rec.record_id ?? rec.id) || 0;
    if (!(recordId > 0)) continue;

    const deleted = Boolean(rec.deleted);
    const datetime = parseAppointmentDatetime(rec.date);
    const lines = normalizeLines(rec.services);
    const seanceLength = normalizeSeanceLength(
      rec.seance_length,
      (rec.services || []).map(
        (s: { duration?: number; seance_length?: number; length?: number }) =>
          Number(s.duration ?? s.seance_length ?? s.length) || 0,
      ),
    );
    const attendance =
      rec.attendance === -1 ||
      rec.attendance === 0 ||
      rec.attendance === 1 ||
      rec.attendance === 2
        ? rec.attendance
        : null;
    const altegioStaffId = Number(rec.staff_id) || null;
    const altegioClientId =
      Number((rec as { client_id?: number; client?: { id?: number } }).client_id ?? (rec as { client?: { id?: number } }).client?.id) ||
      null;
    const altegioVisitId = Number(rec.visit_id) || null;
    const comment = (rec as { comment?: string | null }).comment || null;
    const clientName = rec.client_name ?? null;
    const clientPhone = rec.client_phone ?? null;

    const existing = existingByRecordId.get(recordId);
    // enrich / одноденний синк — завжди пишемо (checkout + дотягування клієнта)
    const forceWrite = params.enrich === true || params.startDate === params.endDate;
    if (
      !forceWrite &&
      existing &&
      isJournalAppointmentUnchanged(existing, {
        deleted,
        datetime,
        seanceLength,
        attendance,
        altegioStaffId,
        altegioClientId: altegioClientId && altegioClientId > 0 ? altegioClientId : null,
        altegioVisitId: altegioVisitId && altegioVisitId > 0 ? altegioVisitId : null,
        comment,
        clientName,
        clientPhone,
        lines,
      })
    ) {
      skipped += 1;
      continue;
    }

    if (!loggedFirst) {
      loggedFirst = true;
      console.log("[journal] Перший запис Altegio для синку (зміна/новий):", {
        recordId,
        date: rec.date,
        seance_length: rec.seance_length,
        client_name: rec.client_name,
        client_id: (rec as { client_id?: number }).client_id,
        services: (rec.services || []).map((s: { title?: string; name?: string; duration?: number }) => ({
          title: s.title || s.name,
          duration: s.duration,
        })),
      });
    }

    await upsertSalonAppointmentFromAltegio(
      {
        status: deleted ? "delete" : "update",
        deleted,
        altegioRecordId: recordId,
        altegioVisitId: rec.visit_id,
        altegioClientId,
        altegioStaffId: rec.staff_id ?? null,
        staffName: rec.staff_name ?? null,
        datetime: rec.date,
        seanceLength: rec.seance_length ?? undefined,
        attendance: rec.attendance,
        comment,
        clientName,
        clientPhone,
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
    `[journal] Sync Altegio ${params.startDate}…${params.endDate}` +
      `${params.mode ? ` mode=${params.mode}` : ""}: отримано=${records.length}, записано=${upserted}, пропущено(без змін)=${skipped} enrich=${params.enrich === true}`,
  );
  return { count: records.length, upserted, skipped };
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
