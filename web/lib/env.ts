// web/lib/env.ts
export const ENV = {
  KEYCRM_API_URL: process.env.KEYCRM_API_URL?.trim() || "",
  KEYCRM_API_TOKEN: process.env.KEYCRM_API_TOKEN?.trim() || "",
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
