// web/lib/altegio/env.ts
// Окрема конфігурація для Alteg.io API (не залежить від KeyCRM)

const ALTEGIO_DEFAULT_API_URL = "https://api.alteg.io/api/v1";

export const ALTEGIO_ENV = {
  API_URL: process.env.ALTEGIO_API_URL?.trim() || ALTEGIO_DEFAULT_API_URL,
  // USER_TOKEN - використовуємо для тестування та розробки
  USER_TOKEN: process.env.ALTEGIO_USER_TOKEN?.trim() || "",
  // PARTNER_TOKEN - для продакшену (поки не потрібен)
  PARTNER_TOKEN: process.env.ALTEGIO_PARTNER_TOKEN?.trim() || "",
};

export function assertAltegioEnv() {
  if (!ALTEGIO_ENV.API_URL) {
    throw new Error("Missing env ALTEGIO_API_URL");
  }
  // Для тестування достатньо USER_TOKEN
  if (!ALTEGIO_ENV.USER_TOKEN && !ALTEGIO_ENV.PARTNER_TOKEN) {
    throw new Error("Missing env ALTEGIO_USER_TOKEN or ALTEGIO_PARTNER_TOKEN");
  }
}

/**
 * Заголовки авторизації для Alteg.io API
 * Формат для USER_TOKEN: "Bearer <user_token>"
 * Формат для PARTNER_TOKEN: "Bearer <partner_token>, User <user_token>"
 */
export function altegioHeaders(includeUserToken = true) {
  assertAltegioEnv();
  
  // Якщо є партнерський токен - використовуємо повний формат
  if (ALTEGIO_ENV.PARTNER_TOKEN) {
    const authParts = [`Bearer ${ALTEGIO_ENV.PARTNER_TOKEN}`];
    
    if (includeUserToken && ALTEGIO_ENV.USER_TOKEN) {
      authParts.push(`User ${ALTEGIO_ENV.USER_TOKEN}`);
    }
    
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authParts.join(", "),
    };
  }
  
  // Для тестування: використовуємо тільки USER_TOKEN
  if (ALTEGIO_ENV.USER_TOKEN) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${ALTEGIO_ENV.USER_TOKEN}`,
    };
  }
  
  throw new Error("No valid Altegio token configured");
}

/**
 * Формує повний URL для Alteg.io API
 */
export function altegioUrl(path: string): string {
  const base = ALTEGIO_ENV.API_URL.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

