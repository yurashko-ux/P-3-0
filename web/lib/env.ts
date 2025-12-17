// web/lib/env.ts

const KEYCRM_DEFAULT_API_URL = "https://openapi.keycrm.app/v1";
const KEYCRM_DEFAULT_API_TOKEN =
  "M2EwMjAwMGE1ZWY4ODhkMzlkYzRiNTU2MDY4ZjZmZDc3ZGJkZjQ3MA";

const KEYCRM_FALLBACKS: Record<string, string> = {
  KEYCRM_API_URL: KEYCRM_DEFAULT_API_URL,
  KEYCRM_API_BASE: KEYCRM_DEFAULT_API_URL,
  KEYCRM_BASE_URL: KEYCRM_DEFAULT_API_URL,
  KEYCRM_API_TOKEN: KEYCRM_DEFAULT_API_TOKEN,
  KEYCRM_TOKEN: KEYCRM_DEFAULT_API_TOKEN,
  KEYCRM_BEARER: KEYCRM_DEFAULT_API_TOKEN,
  KEYCRM_API_BEARER: KEYCRM_DEFAULT_API_TOKEN,
};

export const ENV = {
  // KeyCRM
  KEYCRM_API_URL:
    process.env.KEYCRM_API_URL?.trim() || KEYCRM_DEFAULT_API_URL,
  KEYCRM_API_TOKEN:
    process.env.KEYCRM_API_TOKEN?.trim() ||
    process.env.KEYCRM_BEARER?.trim() ||
    KEYCRM_DEFAULT_API_TOKEN,
  KEYCRM_BEARER:
    process.env.KEYCRM_BEARER?.trim() ||
    process.env.KEYCRM_API_TOKEN?.trim() ||
    KEYCRM_DEFAULT_API_TOKEN,

  // Altegio / Альтеджіо
  ALTEGIO_API_URL: process.env.ALTEGIO_API_URL?.trim() || "",
  ALTEGIO_APPLICATION_ID: process.env.ALTEGIO_APPLICATION_ID?.trim() || "",
  ALTEGIO_PARTNER_ID: process.env.ALTEGIO_PARTNER_ID?.trim() || "",
  ALTEGIO_PARTNER_TOKEN: process.env.ALTEGIO_PARTNER_TOKEN?.trim() || "",
  ALTEGIO_USER_TOKEN: process.env.ALTEGIO_USER_TOKEN?.trim() || "",
  ALTEGIO_COMPANY_ID: process.env.ALTEGIO_COMPANY_ID?.trim() || "",
};

// невелика перевірка, щоб ловити відсутні змінні ще на сервері
export function assertKeycrmEnv() {
  if (!ENV.KEYCRM_API_URL) {
    throw new Error("Missing env KEYCRM_API_URL");
  }
  if (!ENV.KEYCRM_API_TOKEN) {
    throw new Error("Missing env KEYCRM_API_TOKEN");
  }
}

/** Базова перевірка змінних середовища для Altegio */
export function assertAltegioEnv() {
  if (!ENV.ALTEGIO_API_URL) {
    throw new Error("Missing env ALTEGIO_API_URL");
  }
  if (!ENV.ALTEGIO_PARTNER_TOKEN) {
    throw new Error("Missing env ALTEGIO_PARTNER_TOKEN");
  }
  if (!ENV.ALTEGIO_USER_TOKEN) {
    throw new Error("Missing env ALTEGIO_USER_TOKEN");
  }
  if (!ENV.ALTEGIO_COMPANY_ID) {
    throw new Error("Missing env ALTEGIO_COMPANY_ID");
  }
}

function ensureBearer(value: string): string {
  return value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value}`;
}

/** Заголовки авторизації для KeyCRM */
export function keycrmHeaders() {
  // KeyCRM очікує Bearer токен
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: ensureBearer(ENV.KEYCRM_BEARER),
  };
}

/** Склеює відносний шлях із базовим URL */
export function keycrmUrl(path: string) {
  const base = ENV.KEYCRM_API_URL.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

export function resolveKeycrmBaseUrl(): string {
  return ENV.KEYCRM_API_URL;
}

export function resolveKeycrmBearer(): string {
  return ensureBearer(ENV.KEYCRM_BEARER);
}

export function resolveKeycrmToken(): string {
  return ENV.KEYCRM_API_TOKEN;
}

export const KEYCRM_DEFAULTS = {
  API_URL: KEYCRM_DEFAULT_API_URL,
  API_TOKEN: KEYCRM_DEFAULT_API_TOKEN,
};

// --- ManyChat / загальні хелпери змінних середовища ---

const lowerCaseMap: Map<string, string | undefined> = new Map();
for (const [key, value] of Object.entries(process.env)) {
  lowerCaseMap.set(key.toLowerCase(), value);
}

function coerceValue(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getEnvValue(...names: Array<string>): string | undefined {
  for (const name of names) {
    const direct = process.env[name];
    const coerced = coerceValue(direct);
    if (coerced !== undefined) return coerced;
  }

  for (const name of names) {
    const lower = lowerCaseMap.get(name.toLowerCase());
    const coerced = coerceValue(lower);
    if (coerced !== undefined) return coerced;
  }

  for (const name of names) {
    const fallback = KEYCRM_FALLBACKS[name.toUpperCase()];
    if (fallback) return fallback;
  }

  return undefined;
}

export function hasEnvValue(...names: Array<string>): boolean {
  return getEnvValue(...names) !== undefined;
}

/** Заголовки авторизації для Altegio (partner + user токени) */
export function altegioHeaders() {
  // Altegio REST API очікує:
  // Authorization: Bearer <partner_token>, User <user_token>
  return {
    Accept: "application/vnd.api.v2+json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${ENV.ALTEGIO_PARTNER_TOKEN}, User ${ENV.ALTEGIO_USER_TOKEN}`,
  };
}

/** Склеює відносний шлях із базовим URL Altegio */
export function altegioUrl(path: string) {
  const base = (ENV.ALTEGIO_API_URL || "https://api.alteg.io/api/v1").replace(
    /\/+$/,
    "",
  );
  const rel = path.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

