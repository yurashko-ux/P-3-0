// web/lib/env.ts
export const ENV = {
  KEYCRM_API_URL: process.env.KEYCRM_API_URL?.trim() || "",
  KEYCRM_API_TOKEN: process.env.KEYCRM_API_TOKEN?.trim() || "",

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

/** Заголовки авторизації для KeyCRM */
export function keycrmHeaders() {
  // KeyCRM очікує Bearer токен
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${ENV.KEYCRM_API_TOKEN}`,
  };
}

/** Склеює відносний шлях із базовим URL */
export function keycrmUrl(path: string) {
  const base = ENV.KEYCRM_API_URL.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${base}/${rel}`;
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
  const base = (ENV.ALTEGIO_API_URL || "https://api.alteg.io/api/v1").replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${base}/${rel}`;
}
