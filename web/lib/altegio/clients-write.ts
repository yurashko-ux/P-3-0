// Створення / пошук клієнта Altegio для онлайн-запису.

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано");
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

function unwrapList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const data = unwrapData(raw);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    if (Array.isArray((data as any).clients)) return (data as any).clients;
    if (Array.isArray((data as any).data)) return (data as any).data;
  }
  return [];
}

function extractClientId(raw: unknown): number | null {
  const data = unwrapData(raw);
  const candidates = [
    (data as any)?.id,
    (data as any)?.client_id,
    Array.isArray(data) ? (data[0] as any)?.id : null,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function phoneDigits(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

function phonesLikelyMatch(a: unknown, b: string): boolean {
  const da = phoneDigits(String(a || ""));
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const aTail = da.slice(-9);
  const bTail = db.slice(-9);
  return aTail.length >= 9 && aTail === bTail;
}

/** Пошук клієнта Altegio за телефоном (нормалізований 380…). */
export async function findAltegioClientIdByPhone(phoneNorm: string): Promise<number | null> {
  const companyId = resolveCompanyId();
  const digits = phoneDigits(phoneNorm);
  if (digits.length < 9) return null;

  const attempts: Array<{ path: string; init?: RequestInit }> = [
    {
      path: `/company/${companyId}/clients/search`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 1,
          page_size: 20,
          fields: ["id", "name", "phone"],
          phone: digits,
        }),
      },
    },
    {
      path: `/company/${companyId}/clients/search`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 1,
          page_size: 20,
          fields: ["id", "name", "phone"],
          filters: [{ type: "quick_search", state: { value: digits } }],
        }),
      },
    },
    { path: `/clients/${companyId}?phone=${encodeURIComponent(digits)}&page=1&count=20` },
  ];

  for (const attempt of attempts) {
    try {
      const raw = await altegioFetch<unknown>(attempt.path, attempt.init);
      const rows = unwrapList(raw);
      const hit = rows.find((row) => phonesLikelyMatch(row?.phone, digits));
      const id = hit ? Number(hit.id) : null;
      if (id && id > 0) {
        console.log(`[altegio/clients-write] Знайдено клієнта за телефоном id=${id}`);
        return id;
      }
    } catch (err) {
      const msg = err instanceof AltegioHttpError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
      console.warn(`[altegio/clients-write] Пошук за телефоном (${attempt.path}): ${msg}`);
    }
  }
  return null;
}

/** Створити клієнта в Altegio. phone — цифри (бажано 380…). */
export async function createAltegioClient(params: {
  name: string;
  phone: string;
  comment?: string | null;
}): Promise<number> {
  const companyId = resolveCompanyId();
  const name = String(params.name || "").trim();
  const phone = phoneDigits(params.phone);
  if (!name) throw new Error("Вкажіть імʼя клієнта");
  if (phone.length < 10) throw new Error("Вкажіть коректний телефон");

  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || name;
  const surname = parts.length > 1 ? parts.slice(1).join(" ") : "";

  const payload: Record<string, unknown> = {
    name: firstName,
    phone: Number(phone) || phone,
    comment: params.comment || "онлайн-запис Kresco",
  };
  if (surname) payload.surname = surname;

  try {
    const raw = await altegioFetch<unknown>(`/clients/${companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const id = extractClientId(raw);
    if (!id) {
      throw new Error("Altegio створив клієнта, але не повернув id");
    }
    console.log(`[altegio/clients-write] ✅ Створено клієнта Altegio id=${id} phone=${phone}`);
    return id;
  } catch (err) {
    if (err instanceof AltegioHttpError) {
      throw new Error(`Altegio створення клієнта: HTTP ${err.status} ${String(err.responseBody || "").slice(0, 300)}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Знайти або створити клієнта Altegio за телефоном. */
export async function ensureAltegioClientId(params: {
  name: string;
  phone: string;
  comment?: string | null;
}): Promise<{ altegioClientId: number; created: boolean }> {
  const existing = await findAltegioClientIdByPhone(params.phone);
  if (existing) return { altegioClientId: existing, created: false };
  const altegioClientId = await createAltegioClient(params);
  return { altegioClientId, created: true };
}
