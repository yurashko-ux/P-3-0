// Архів Altegio: уся історія, яку віддає API.
// Не створює лідів Direct і не пише в FinanceOperation.

import { AltegioHttpError, altegioFetch } from "@/lib/altegio/client";
import { syncAltegioFinanceTransactions } from "@/lib/altegio/finance-transactions-sync";
import { getAllRecordsForLocation } from "@/lib/altegio/records";
import { resolveJournalCompanyId } from "@/lib/journal/company-id";
import { syncAppointmentsRangeFromAltegio } from "@/lib/journal";
import { prisma } from "@/lib/prisma";

const CLIENT_PAGE_SIZE = 100;
const PAYMENT_BATCH = 24;

export type ArchiveInventory = {
  companyId: string;
  earliestRecordDay: string | null;
  recordsApiTotal: number | null;
  clientsApiSample: number;
  local: {
    directClientsLinked: number;
    appointments: number;
    appointmentMinDay: string | null;
    financeTransactions: number;
    financeMinDay: string | null;
    archiveClients: number;
    visitPayments: number;
    visitPaymentScans: number;
  };
};

function kyivToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthEnd(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(last)}`;
}

export function eachMonth(fromYmd: string, toYmd: string): Array<{ start: string; end: string; key: string }> {
  const out: Array<{ start: string; end: string; key: string }> = [];
  let year = Number(fromYmd.slice(0, 4));
  let month = Number(fromYmd.slice(5, 7));
  const endYear = Number(toYmd.slice(0, 4));
  const endMonth = Number(toYmd.slice(5, 7));
  if (!year || !month || !endYear || !endMonth) return out;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const start = `${year}-${pad2(month)}-01`;
    const endRaw = monthEnd(year, month);
    const end = endRaw > toYmd ? toYmd : endRaw;
    const clampedStart = start < fromYmd ? fromYmd : start;
    out.push({ start: clampedStart, end, key: `${year}-${pad2(month)}` });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function phoneOf(value: unknown): string | null {
  if (Array.isArray(value)) return phoneOf(value[0]);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return phoneOf(obj.number ?? obj.phone ?? obj.value);
  }
  const text = String(value ?? "").trim();
  return text || null;
}

function nameOf(raw: Record<string, unknown>): string | null {
  const parts = [raw.surname, raw.last_name, raw.name, raw.first_name, raw.middle_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.join(" ").trim() || null;
}

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as Record<string, unknown>;
  for (const key of ["data", "clients", "items", "transactions", "results"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  const nested = payload.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    for (const key of ["data", "clients", "items", "transactions"]) {
      if (Array.isArray(inner[key])) return inner[key] as unknown[];
    }
  }
  return [];
}

function metaTotal(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = (raw as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object") return null;
  const bag = meta as Record<string, unknown>;
  const total = bag.total_count ?? bag.total ?? bag.count;
  const n = Number(total);
  return Number.isFinite(n) ? n : null;
}

async function saveCursor(companyId: string, syncKey: string, cursor: string, status: string, detail?: string) {
  await prisma.altegioArchiveCursor.upsert({
    where: { companyId_syncKey: { companyId, syncKey } },
    create: { companyId, syncKey, cursor, status, detail: detail || null },
    update: { cursor, status, detail: detail || null },
  });
  console.log(`[altegio/archive] Курсор ${syncKey}=${cursor || "—"} ${status}${detail ? ` ${detail}` : ""}`);
}

async function readCursor(companyId: string, syncKey: string): Promise<string> {
  const row = await prisma.altegioArchiveCursor.findUnique({
    where: { companyId_syncKey: { companyId, syncKey } },
    select: { cursor: true },
  });
  return row?.cursor || "";
}

export async function inventoryAltegioArchive(): Promise<ArchiveInventory> {
  const companyIdNum = resolveJournalCompanyId();
  const companyId = String(companyIdNum);
  const today = kyivToday();
  const earliestRecordDay = await findEarliestRecordDay(companyIdNum, today);
  const recordsNow = await getAllRecordsForLocation(companyIdNum, {
    startDate: earliestRecordDay || "2015-01-01",
    endDate: today,
    count: 1,
    page: 1,
  });
  const clientPage = await fetchClientsPage(companyIdNum, 1);
  const [directClientsLinked, appointments, appointmentMin, financeTransactions, financeMin, archiveClients, visitPayments, visitPaymentScans] =
    await Promise.all([
      prisma.directClient.count({ where: { altegioClientId: { not: null } } }),
      prisma.salonAppointment.count({ where: { altegioRecordId: { not: null } } }),
      prisma.salonAppointment.findFirst({
        where: { altegioRecordId: { not: null } },
        orderBy: { kyivDay: "asc" },
        select: { kyivDay: true },
      }),
      prisma.altegioFinanceTransaction.count({ where: { companyId } }),
      prisma.altegioFinanceTransaction.findFirst({
        where: { companyId },
        orderBy: { kyivDay: "asc" },
        select: { kyivDay: true },
      }),
      prisma.altegioClientArchive.count({ where: { companyId } }),
      prisma.altegioVisitPayment.count({ where: { companyId } }),
      prisma.altegioVisitPaymentScan.count({ where: { companyId } }),
    ]);

  const inventory: ArchiveInventory = {
    companyId,
    earliestRecordDay,
    recordsApiTotal: recordsNow.totalCount ?? null,
    clientsApiSample: clientPage.clients.length,
    local: {
      directClientsLinked,
      appointments,
      appointmentMinDay: appointmentMin?.kyivDay || null,
      financeTransactions,
      financeMinDay: financeMin?.kyivDay || null,
      archiveClients,
      visitPayments,
      visitPaymentScans,
    },
  };
  console.log("[altegio/archive] Інвентаризація", inventory);
  return inventory;
}

async function findEarliestRecordDay(companyId: number, today: string): Promise<string | null> {
  const endYear = Number(today.slice(0, 4));
  let sawMeta = false;
  let foundYear: number | null = null;
  for (let year = 2015; year <= endYear; year += 1) {
    const page = await getAllRecordsForLocation(companyId, {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      count: 1,
      page: 1,
    });
    if (page.totalCount == null && page.records.length === 0 && !sawMeta) {
      throw new Error("Altegio не віддав записи. Перевірте доступ API.");
    }
    if (page.totalCount != null) sawMeta = true;
    const count = page.totalCount ?? page.records.length;
    console.log(`[altegio/archive] Записи ${year}: ${count}`);
    if (count > 0) {
      foundYear = year;
      break;
    }
  }
  if (!sawMeta && foundYear == null) {
    throw new Error("Altegio не віддав meta записів. Інвентаризацію зупинено.");
  }
  if (foundYear == null) return null;

  let foundMonth = 1;
  for (let month = 1; month <= 12; month += 1) {
    const page = await getAllRecordsForLocation(companyId, {
      startDate: `${foundYear}-${pad2(month)}-01`,
      endDate: monthEnd(foundYear, month),
      count: 1,
      page: 1,
    });
    const count = page.totalCount ?? page.records.length;
    if (count > 0) {
      foundMonth = month;
      break;
    }
  }
  return `${foundYear}-${pad2(foundMonth)}-01`;
}

async function fetchClientsPage(companyId: number, page: number): Promise<{ clients: Record<string, unknown>[]; total: number | null }> {
  const bodies = [
    {
      page,
      page_size: CLIENT_PAGE_SIZE,
      fields: ["id", "name", "surname", "phone", "email", "spent", "visits", "last_visit_date"],
      order_by: "id",
      order_by_direction: "asc",
    },
    { page, page_size: CLIENT_PAGE_SIZE },
  ];
  let lastError: unknown = null;
  for (const body of bodies) {
    try {
      const raw = await altegioFetch<unknown>(`/company/${companyId}/clients/search`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const clients = unwrapList(raw).filter((row) => row && typeof row === "object") as Record<string, unknown>[];
      if (clients.length === 0 && body === bodies[0]) continue;
      return { clients, total: metaTotal(raw) };
    } catch (err) {
      lastError = err;
      console.warn(
        `[altegio/archive] Сторінка клієнтів ${page} не вдалась:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  return { clients: [], total: null };
}

async function directClientMap(): Promise<Map<number, string>> {
  const rows = await prisma.directClient.findMany({
    where: { altegioClientId: { not: null } },
    select: { id: true, altegioClientId: true },
  });
  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.altegioClientId && row.altegioClientId > 0) map.set(row.altegioClientId, row.id);
  }
  return map;
}

export async function syncArchiveClients(companyId = String(resolveJournalCompanyId()), maxPages = 2000): Promise<number> {
  const existingCursor = await readCursor(companyId, "clients");
  if (existingCursor === "done") {
    const count = await prisma.altegioClientArchive.count({ where: { companyId } });
    console.log(`[altegio/archive] Клієнти вже залиті: ${count}`);
    return count;
  }
  const companyIdNum = Number(companyId);
  const links = await directClientMap();
  let page = Number(existingCursor) || 1;
  if (page < 1) page = 1;
  let upserted = 0;
  let finished = false;
  const seen = new Set<number>();
  await saveCursor(companyId, "clients", String(page), "running");
  for (let guard = 0; guard < maxPages; guard += 1) {
    const batch = await fetchClientsPage(companyIdNum, page);
    if (batch.clients.length === 0) {
      finished = true;
      break;
    }
    let fresh = 0;
    for (const raw of batch.clients) {
      const altegioClientId = Number(raw.id);
      if (!(altegioClientId > 0) || seen.has(altegioClientId)) continue;
      seen.add(altegioClientId);
      fresh += 1;
      const phone = phoneOf(raw.phone);
      await prisma.altegioClientArchive.upsert({
        where: { companyId_altegioClientId: { companyId, altegioClientId } },
        create: {
          companyId,
          altegioClientId,
          name: nameOf(raw),
          phone,
          email: String(raw.email ?? "").trim() || null,
          spent: numOrNull(raw.spent ?? raw.total_spent ?? raw.sold_amount),
          visits: numOrNull(raw.visits ?? raw.visits_count ?? raw.success_visits_count),
          lastVisitAt: parseDate(raw.last_visit_date ?? raw.lastVisitAt),
          directClientId: links.get(altegioClientId) || null,
          rawData: raw as object,
          syncedAt: new Date(),
        },
        update: {
          name: nameOf(raw),
          phone,
          email: String(raw.email ?? "").trim() || null,
          spent: numOrNull(raw.spent ?? raw.total_spent ?? raw.sold_amount),
          visits: numOrNull(raw.visits ?? raw.visits_count ?? raw.success_visits_count),
          lastVisitAt: parseDate(raw.last_visit_date ?? raw.lastVisitAt),
          directClientId: links.get(altegioClientId) || null,
          rawData: raw as object,
          syncedAt: new Date(),
        },
      });
      upserted += 1;
    }
    console.log(`[altegio/archive] Клієнти сторінка ${page}: +${fresh}, разом у проході ${upserted}`);
    if (fresh === 0) {
      finished = true;
      break;
    }
    if (batch.total != null && upserted >= batch.total) {
      finished = true;
      break;
    }
    if (batch.clients.length < CLIENT_PAGE_SIZE) {
      finished = true;
      break;
    }
    page += 1;
    await saveCursor(companyId, "clients", String(page), "running", `upserted=${upserted}`);
    await sleep(200);
  }
  if (finished) {
    await saveCursor(companyId, "clients", "done", "success", `upserted=${upserted}`);
  }
  return upserted;
}

export async function syncArchiveVisits(
  companyId = String(resolveJournalCompanyId()),
  earliestRecordDay?: string | null,
  maxMonths = 1000,
): Promise<number> {
  const from = earliestRecordDay === undefined ? (await inventoryAltegioArchive()).earliestRecordDay : earliestRecordDay;
  if (!from) {
    await saveCursor(companyId, "visits", "", "success", "немає записів");
    return 0;
  }
  const today = kyivToday();
  const doneThrough = await readCursor(companyId, "visits");
  let upserted = 0;
  let processed = 0;
  let lastKey = doneThrough;
  await saveCursor(companyId, "visits", doneThrough, "running");
  for (const month of eachMonth(from, today)) {
    if (doneThrough && month.key <= doneThrough) continue;
    const result = await syncAppointmentsRangeFromAltegio({
      startDate: month.start,
      endDate: month.end,
      enrich: false,
    });
    upserted += result.upserted;
    processed += 1;
    lastKey = month.key;
    await saveCursor(companyId, "visits", month.key, "running", `місяць ${month.key} +${result.upserted}`);
    await sleep(250);
    if (processed >= maxMonths) break;
  }
  const finished = processed === 0 || !lastKey || lastKey >= today.slice(0, 7);
  await saveCursor(
    companyId,
    "visits",
    lastKey || today.slice(0, 7),
    finished ? "success" : "running",
    `upserted=${upserted}`,
  );
  return upserted;
}

function methodOf(raw: Record<string, unknown>): string | null {
  const account = raw.account;
  if (account && typeof account === "object") {
    const title = String((account as Record<string, unknown>).title || (account as Record<string, unknown>).name || "").trim();
    if (title) return title;
  }
  const direct = String(raw.account_title || raw.payment_type || raw.type || "").trim();
  if (direct && direct !== "[object Object]") return direct;
  return null;
}

function amountOf(raw: Record<string, unknown>): number {
  const value = raw.amount ?? raw.sum ?? raw.value ?? raw.payment_amount ?? raw.paid_sum ?? raw.cost;
  const n = Number(typeof value === "string" ? value.replace(",", ".") : value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export async function syncArchiveVisitPayments(
  companyId = String(resolveJournalCompanyId()),
  maxBatches = 100000,
): Promise<number> {
  const companyIdNum = Number(companyId);
  let stored = 0;
  let errors = 0;
  await saveCursor(companyId, "visit-payments", "", "running");
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; altegioRecordId: number; altegioClientId: number | null; clientName: string | null; kyivDay: string }>
    >`
      SELECT a."id", a."altegioRecordId", a."altegioClientId", a."clientName", a."kyivDay"
      FROM "salon_appointments" a
      LEFT JOIN "altegio_visit_payment_scans" s
        ON s."altegioRecordId" = a."altegioRecordId" AND s."companyId" = ${companyId}
      WHERE a."altegioRecordId" IS NOT NULL AND s."id" IS NULL
      ORDER BY a."kyivDay" ASC
      LIMIT ${PAYMENT_BATCH}
    `;
    if (rows.length === 0) {
      await saveCursor(companyId, "visit-payments", "done", "success", `payments=${stored}`);
      return stored;
    }
    for (const row of rows) {
      try {
        const count = await storeRecordPayments(companyId, companyIdNum, row);
        stored += count;
        errors = 0;
      } catch (err) {
        errors += 1;
        console.warn(
          `[altegio/archive] Оплати запису ${row.altegioRecordId}:`,
          err instanceof Error ? err.message : err,
        );
        if (errors >= 15) {
          await saveCursor(companyId, "visit-payments", String(row.altegioRecordId), "failed", "багато помилок API");
          throw err;
        }
      }
    }
    await saveCursor(companyId, "visit-payments", String(rows[rows.length - 1]?.altegioRecordId || ""), "running", `рядків оплат ${stored}`);
  }
  await saveCursor(companyId, "visit-payments", "done", "running", `payments=${stored}`);
  return stored;
}

async function storeRecordPayments(
  companyId: string,
  companyIdNum: number,
  row: { id: string; altegioRecordId: number; altegioClientId: number | null; clientName: string | null; kyivDay: string },
): Promise<number> {
  let raw: unknown;
  try {
    raw = await altegioFetch<unknown>(
      `timetable/transactions/${companyIdNum}?record_id=${row.altegioRecordId}`,
      { method: "GET" },
    );
  } catch (err) {
    if (err instanceof AltegioHttpError && err.status === 404) {
      await prisma.altegioVisitPaymentScan.upsert({
        where: { companyId_altegioRecordId: { companyId, altegioRecordId: row.altegioRecordId } },
        create: { companyId, altegioRecordId: row.altegioRecordId, paymentCount: 0 },
        update: { paymentCount: 0, scannedAt: new Date() },
      });
      return 0;
    }
    throw err;
  }
  const list = unwrapList(raw).filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: row.id },
      select: { lines: { select: { title: true } }, participants: { select: { altegioStaffId: true, staffName: true } } },
  });
  const staffById = new Map<number, string>();
  for (const participant of appointment?.participants || []) {
    if (participant.altegioStaffId > 0 && participant.staffName) staffById.set(participant.altegioStaffId, participant.staffName);
  }
  const serviceTitle =
    (appointment?.lines || [])
      .map((line) => line.title)
      .filter(Boolean)
      .join("; ") || null;

  let kept = 0;
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const altegioTransactionId = numOrNull(item.id ?? item.transaction_id ?? item.payment_id);
    const txKey = altegioTransactionId ? String(altegioTransactionId) : `row-${index}`;
    const staffId = numOrNull(item.staff_id ?? (item.staff as { id?: unknown } | undefined)?.id);
    const staffName =
      staffById.get(staffId || 0) ||
      String(
        (item.staff as { name?: unknown; title?: unknown } | undefined)?.name ||
          (item.staff as { title?: unknown } | undefined)?.title ||
          item.staff_name ||
          "",
      ).trim() ||
      null;
    const deleted = item.deleted === true || item.deleted === 1 || item.is_deleted === true || item.is_deleted === 1;
    await prisma.altegioVisitPayment.upsert({
      where: { companyId_altegioRecordId_txKey: { companyId, altegioRecordId: row.altegioRecordId, txKey } },
      create: {
        companyId,
        altegioRecordId: row.altegioRecordId,
        txKey,
        altegioTransactionId: altegioTransactionId && altegioTransactionId > 0 ? altegioTransactionId : null,
        appointmentId: row.id,
        altegioClientId: row.altegioClientId,
        clientName: row.clientName,
        kyivDay: row.kyivDay,
        amount: amountOf(item),
        method: methodOf(item),
        staffId: staffId && staffId > 0 ? staffId : null,
        staffName,
        serviceTitle,
        deleted: Boolean(deleted),
        rawData: item as object,
        syncedAt: new Date(),
      },
      update: {
        appointmentId: row.id,
        altegioClientId: row.altegioClientId,
        clientName: row.clientName,
        kyivDay: row.kyivDay,
        amount: amountOf(item),
        method: methodOf(item),
        staffId: staffId && staffId > 0 ? staffId : null,
        staffName,
        serviceTitle,
        deleted: Boolean(deleted),
        rawData: item as object,
        syncedAt: new Date(),
      },
    });
    kept += 1;
  }
  await prisma.altegioVisitPaymentScan.upsert({
    where: { companyId_altegioRecordId: { companyId, altegioRecordId: row.altegioRecordId } },
    create: { companyId, altegioRecordId: row.altegioRecordId, paymentCount: kept },
    update: { paymentCount: kept, scannedAt: new Date() },
  });
  return kept;
}

export async function syncArchiveFinance(
  companyId = String(resolveJournalCompanyId()),
  earliestRecordDay?: string | null,
  maxYears = 100,
): Promise<number> {
  const from =
    earliestRecordDay === undefined
      ? (await inventoryAltegioArchive()).earliestRecordDay || "2015-01-01"
      : earliestRecordDay || "2015-01-01";
  const today = kyivToday();
  const doneThrough = await readCursor(companyId, "finance");
  let upserted = 0;
  let processed = 0;
  let lastYear = doneThrough;
  await saveCursor(companyId, "finance", doneThrough, "running");
  const years = [...new Set(eachMonth(from, today).map((month) => month.key.slice(0, 4)))].sort();
  for (const year of years) {
    if (doneThrough && /^\d{4}$/.test(doneThrough) && year <= doneThrough) continue;
    const dateFrom = `${year}-01-01` < from ? from : `${year}-01-01`;
    const dateTo = `${year}-12-31` > today ? today : `${year}-12-31`;
    const result = await syncAltegioFinanceTransactions({
      companyId,
      dateFrom,
      dateTo,
      maxPages: 100,
      syncPurposes: year === today.slice(0, 4),
    });
    upserted += result.upserted;
    if (result.fetched >= 100000) {
      console.warn(`[altegio/archive] Рік ${year} уперся в стелю сторінок, ділю на місяці`);
      for (const month of eachMonth(dateFrom, dateTo)) {
        const monthResult = await syncAltegioFinanceTransactions({
          companyId,
          dateFrom: month.start,
          dateTo: month.end,
          maxPages: 100,
          syncPurposes: false,
        });
        upserted += monthResult.upserted;
      }
    }
    await saveCursor(companyId, "finance", year, "running", `рік ${year} +${result.upserted}`);
    processed += 1;
    lastYear = year;
    if (processed >= maxYears) break;
  }
  const finished = processed === 0 || !lastYear || lastYear >= today.slice(0, 4);
  if (!finished) {
    await saveCursor(companyId, "finance", lastYear, "running", `upserted=${upserted}`);
    return upserted;
  }
  await prisma.altegioFinanceSyncState.upsert({
    where: { companyId_syncKey: { companyId, syncKey: "altegio-finance-transactions" } },
    create: {
      companyId,
      syncKey: "altegio-finance-transactions",
      status: "success",
      lastSyncedFrom: new Date(`${from}T00:00:00.000+03:00`),
      lastSyncedTo: new Date(`${today}T12:00:00.000+03:00`),
      syncedCount: upserted,
      finishedAt: new Date(),
    },
    update: {
      status: "success",
      lastSyncedFrom: new Date(`${from}T00:00:00.000+03:00`),
      lastSyncedTo: new Date(`${today}T12:00:00.000+03:00`),
      lastError: null,
      syncedCount: upserted,
      finishedAt: new Date(),
    },
  });
  await saveCursor(companyId, "finance", today.slice(0, 4), "success", `upserted=${upserted}`);
  return upserted;
}

export async function reconcileArchiveMonths(
  companyId = String(resolveJournalCompanyId()),
  earliestRecordDay?: string | null,
  maxMonths = 1000,
): Promise<number> {
  const companyIdNum = Number(companyId);
  const from = earliestRecordDay === undefined ? (await inventoryAltegioArchive()).earliestRecordDay : earliestRecordDay;
  if (!from) return 0;
  const today = kyivToday();
  const doneThrough = await readCursor(companyId, "reconcile");
  if (doneThrough === "done") return 0;
  let checks = 0;
  let processed = 0;
  let lastKey = doneThrough;
  for (const month of eachMonth(from, today)) {
    if (doneThrough && month.key <= doneThrough) continue;
    const records = await getAllRecordsForLocation(companyIdNum, {
      startDate: month.start,
      endDate: month.end,
      count: 1,
      page: 1,
    });
    const dbRecords = await prisma.salonAppointment.count({
      where: {
        altegioRecordId: { not: null },
        kyivDay: { gte: month.start, lte: month.end },
      },
    });
    await prisma.altegioArchiveMonthCheck.upsert({
      where: { companyId_kyivMonth_kind: { companyId, kyivMonth: month.key, kind: "records" } },
      create: {
        companyId,
        kyivMonth: month.key,
        kind: "records",
        apiCount: records.totalCount ?? records.records.length,
        dbCount: dbRecords,
        dbAmount: 0,
        note: records.totalCount == null ? "API не віддав total_count" : null,
      },
      update: {
        apiCount: records.totalCount ?? records.records.length,
        dbCount: dbRecords,
        note: records.totalCount == null ? "API не віддав total_count" : null,
        checkedAt: new Date(),
      },
    });

    const financeRows = await prisma.altegioFinanceTransaction.findMany({
      where: { companyId, kyivDay: { gte: month.start, lte: month.end }, deletedInAltegio: false },
      select: { amountKopiykas: true, direction: true },
    });
    const dbAmount = financeRows.reduce((sum, row) => sum + Number(row.amountKopiykas) / 100, 0);
    const financeRaw = await altegioFetch<unknown>(`/company/${companyId}/finance_transactions/search`, {
      method: "POST",
      body: JSON.stringify({
        start_date: month.start,
        end_date: month.end,
        deleted: false,
        count: 1,
        page: 1,
      }),
    }).catch(() => null);
    await prisma.altegioArchiveMonthCheck.upsert({
      where: { companyId_kyivMonth_kind: { companyId, kyivMonth: month.key, kind: "finance" } },
      create: {
        companyId,
        kyivMonth: month.key,
        kind: "finance",
        apiCount: financeRaw ? metaTotal(financeRaw) ?? 0 : 0,
        dbCount: financeRows.length,
        dbAmount: Math.round(dbAmount * 100) / 100,
        note: financeRaw && metaTotal(financeRaw) == null ? "API без total_count, сума з архіву" : null,
      },
      update: {
        apiCount: financeRaw ? metaTotal(financeRaw) ?? 0 : 0,
        dbCount: financeRows.length,
        dbAmount: Math.round(dbAmount * 100) / 100,
        note: financeRaw && metaTotal(financeRaw) == null ? "API без total_count, сума з архіву" : null,
        checkedAt: new Date(),
      },
    });
    checks += 2;
    processed += 1;
    lastKey = month.key;
    await saveCursor(companyId, "reconcile", month.key, "running", `перевірок ${checks}`);
    await sleep(150);
    if (processed >= maxMonths) break;
  }
  const finished = processed === 0 || !lastKey || lastKey >= today.slice(0, 7);
  await saveCursor(companyId, "reconcile", finished ? "done" : lastKey, finished ? "success" : "running", `перевірок ${checks}`);
  console.log(`[altegio/archive] Звірка місяців: ${checks} рядків`);
  return checks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchArchiveClients(query: string, limit = 30) {
  const q = query.trim();
  const companyId = String(resolveJournalCompanyId());
  return prisma.altegioClientArchive.findMany({
    where: {
      companyId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              ...(/^\d+$/.test(q) ? [{ altegioClientId: Number(q) }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      altegioClientId: true,
      name: true,
      phone: true,
      visits: true,
      spent: true,
      directClientId: true,
    },
  });
}

export async function getArchiveClientDetail(altegioClientId: number) {
  const companyId = String(resolveJournalCompanyId());
  const client = await prisma.altegioClientArchive.findUnique({
    where: { companyId_altegioClientId: { companyId, altegioClientId } },
  });
  const appointments = await prisma.salonAppointment.findMany({
    where: { altegioClientId, status: { not: "deleted" } },
    orderBy: { datetime: "desc" },
    take: 200,
    select: {
      id: true,
      kyivDay: true,
      datetime: true,
      staffName: true,
      attendance: true,
      comment: true,
      lines: { select: { title: true, cost: true } },
    },
  });
  const payments = await prisma.altegioVisitPayment.findMany({
    where: { companyId, altegioClientId, deleted: false },
    orderBy: { kyivDay: "desc" },
    take: 200,
    select: {
      id: true,
      kyivDay: true,
      amount: true,
      method: true,
      staffName: true,
      serviceTitle: true,
      altegioRecordId: true,
    },
  });
  return { client, appointments, payments };
}

export async function listArchiveFinance(from: string, to: string, limit = 100) {
  const companyId = String(resolveJournalCompanyId());
  const rows = await prisma.altegioFinanceTransaction.findMany({
    where: {
      companyId,
      deletedInAltegio: false,
      ...(from && to ? { kyivDay: { gte: from, lte: to } } : {}),
    },
    orderBy: [{ kyivDay: "desc" }, { operationDate: "desc" }],
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map((row) => ({
    id: row.id,
    kyivDay: row.kyivDay,
    documentId: row.documentId,
    counterpartyName: row.counterpartyName,
    paymentPurpose: row.paymentPurpose,
    accountTitle: row.accountTitle,
    comment: row.comment,
    amount: Number(row.amountKopiykas) / 100,
    balance: row.accountBalanceAfterKopiykas != null ? Number(row.accountBalanceAfterKopiykas) / 100 : null,
    direction: row.direction,
  }));
}

export async function archiveOverview() {
  const companyId = String(resolveJournalCompanyId());
  const [clients, appointments, payments, finance, checks, cursors] = await Promise.all([
    prisma.altegioClientArchive.count({ where: { companyId } }),
    prisma.salonAppointment.count({ where: { altegioRecordId: { not: null } } }),
    prisma.altegioVisitPayment.count({ where: { companyId, deleted: false } }),
    prisma.altegioFinanceTransaction.count({ where: { companyId, deletedInAltegio: false } }),
    prisma.altegioArchiveMonthCheck.findMany({
      where: { companyId },
      orderBy: [{ kyivMonth: "desc" }, { kind: "asc" }],
      take: 48,
    }),
    prisma.altegioArchiveCursor.findMany({ where: { companyId }, orderBy: { syncKey: "asc" } }),
  ]);
  return { clients, appointments, payments, finance, checks, cursors };
}

async function cursorStatus(companyId: string, syncKey: string): Promise<string> {
  const row = await prisma.altegioArchiveCursor.findUnique({
    where: { companyId_syncKey: { companyId, syncKey } },
    select: { status: true },
  });
  return row?.status || "";
}

/** Один крок заливи. Крон на Vercel кличе це, доки статус не стане done. */
export async function runAltegioArchiveSlice(): Promise<{ step: string }> {
  const companyId = String(resolveJournalCompanyId());
  let earliest = await readCursor(companyId, "earliest");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earliest)) {
    const inventory = await inventoryAltegioArchive();
    earliest = inventory.earliestRecordDay || "";
    await saveCursor(companyId, "earliest", earliest, "success", earliest || "немає записів");
    console.log("[altegio/archive] Інвентаризація збережена", earliest || "порожньо");
    return { step: "inventory" };
  }
  if ((await readCursor(companyId, "clients")) !== "done") {
    await syncArchiveClients(companyId, 25);
    return { step: "clients" };
  }
  if ((await cursorStatus(companyId, "visits")) !== "success") {
    await syncArchiveVisits(companyId, earliest, 1);
    return { step: "visits" };
  }
  if ((await cursorStatus(companyId, "visit-payments")) !== "success") {
    await syncArchiveVisitPayments(companyId, 8);
    return { step: "visit-payments" };
  }
  if ((await cursorStatus(companyId, "finance")) !== "success") {
    await syncArchiveFinance(companyId, earliest, 1);
    return { step: "finance" };
  }
  if ((await cursorStatus(companyId, "reconcile")) !== "success") {
    await reconcileArchiveMonths(companyId, earliest, 2);
    return { step: "reconcile" };
  }
  return { step: "done" };
}

export async function runAltegioArchive(): Promise<void> {
  const inventory = await inventoryAltegioArchive();
  console.log("[altegio/archive] Старт заливи", inventory.earliestRecordDay);
  const clients = await syncArchiveClients(inventory.companyId);
  const visits = await syncArchiveVisits(inventory.companyId, inventory.earliestRecordDay);
  const payments = await syncArchiveVisitPayments(inventory.companyId);
  const finance = await syncArchiveFinance(inventory.companyId, inventory.earliestRecordDay);
  const checks = await reconcileArchiveMonths(inventory.companyId, inventory.earliestRecordDay);
  console.log("[altegio/archive] Готово", { clients, visits, payments, finance, checks });
}
