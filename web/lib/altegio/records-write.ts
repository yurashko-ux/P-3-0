// Запис журналу в Altegio: створення / перенос / скасування запису.
// Вебхук після цього лише upsert у Kresco, назад у Altegio не пишемо.

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — неможливо писати записи в Altegio");
  }
  return companyId;
}

function unwrapData(raw: unknown): any {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.data != null && typeof obj.data === "object") {
    const inner = obj.data as Record<string, unknown>;
    if (inner.data != null) return inner.data;
    return obj.data;
  }
  return raw;
}

function extractNumericId(raw: unknown): number | null {
  const data = unwrapData(raw);
  const candidates = [
    (data as any)?.id,
    (data as any)?.record_id,
    (data as any)?.recordId,
    Array.isArray(data) ? (data[0] as any)?.id : null,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function formatAltegioError(err: unknown, action: string): Error {
  if (err instanceof AltegioHttpError) {
    const body = String(err.responseBody || "").slice(0, 500);
    return new Error(`Altegio ${action}: HTTP ${err.status} ${body || err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export type AltegioRecordServiceLine = {
  id: number;
  amount?: number;
  firstCost?: number;
  discount?: number;
  cost?: number;
};

export type AltegioRecordWriteInput = {
  staffId: number;
  clientId: number;
  datetime: string;
  seanceLength: number;
  comment?: string;
  attendance?: number;
  services: AltegioRecordServiceLine[];
};

function toPayload(input: AltegioRecordWriteInput) {
  return {
    staff_id: input.staffId,
    client_id: input.clientId,
    client: { id: input.clientId },
    datetime: input.datetime,
    seance_length: input.seanceLength,
    comment: input.comment || "",
    attendance: input.attendance ?? 0,
    save_if_busy: "save",
    send_sms: false,
    services: input.services.map((s) => {
      const amount = Number(s.amount) > 0 ? Number(s.amount) : 1;
      const firstCost = Number(s.firstCost) || Number(s.cost) || 0;
      const discount = Number(s.discount) || 0;
      const cost = Number(s.cost) || firstCost;
      return {
        id: s.id,
        amount,
        first_cost: firstCost,
        discount,
        cost,
      };
    }),
  };
}

export async function createAltegioRecord(input: AltegioRecordWriteInput): Promise<{ id: number; visitId: number | null }> {
  const companyId = resolveCompanyId();
  if (!(input.staffId > 0) || !(input.clientId > 0)) {
    throw new Error("Для запису в Altegio потрібні id майстра і клієнта");
  }
  if (!input.services.length) {
    throw new Error("Додайте хоча б одну послугу");
  }
  try {
    const raw = await altegioFetch<unknown>(`/records/${companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(input)),
    });
    const data = unwrapData(raw);
    const id = extractNumericId(raw);
    if (!id) {
      throw new Error(`Altegio не повернув id запису: ${JSON.stringify(raw).slice(0, 400)}`);
    }
    const visitId = Number(data?.visit_id ?? data?.visitId) || null;
    console.log(`[altegio/records-write] Створено запис id=${id} visit=${visitId || "—"} client=${input.clientId}`);
    return { id, visitId: visitId && visitId > 0 ? visitId : null };
  } catch (err) {
    throw formatAltegioError(err, "створення запису");
  }
}

export async function updateAltegioRecord(
  recordId: number,
  input: AltegioRecordWriteInput,
): Promise<{ id: number; visitId: number | null }> {
  const companyId = resolveCompanyId();
  if (!(recordId > 0)) throw new Error("Немає id запису Altegio для оновлення");
  try {
    const raw = await altegioFetch<unknown>(`/records/${companyId}/${recordId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(input)),
    });
    const data = unwrapData(raw);
    const id = extractNumericId(raw) || recordId;
    const visitId = Number(data?.visit_id ?? data?.visitId) || null;
    console.log(`[altegio/records-write] Оновлено запис id=${id}`);
    return { id, visitId: visitId && visitId > 0 ? visitId : null };
  } catch (err) {
    throw formatAltegioError(err, `оновлення запису ${recordId}`);
  }
}

export async function deleteAltegioRecord(recordId: number): Promise<void> {
  const companyId = resolveCompanyId();
  if (!(recordId > 0)) throw new Error("Немає id запису Altegio для видалення");
  try {
    await altegioFetch<unknown>(`/records/${companyId}/${recordId}`, { method: "DELETE" });
    console.log(`[altegio/records-write] Видалено запис id=${recordId}`);
  } catch (err) {
    throw formatAltegioError(err, `видалення запису ${recordId}`);
  }
}
