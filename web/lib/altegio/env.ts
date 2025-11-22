// web/lib/altegio/env.ts
// Окрема конфігурація для Alteg.io API (не залежить від KeyCRM)

const ALTEGIO_DEFAULT_API_URL = "https://api.alteg.io/api/v1";

export const ALTEGIO_ENV = {
  API_URL: process.env.ALTEGIO_API_URL?.trim() || ALTEGIO_DEFAULT_API_URL,
  // USER_TOKEN - токен користувача, отримується в розділі "Доступ до API" маркетплейсу
  // Працює як для публічних, так і для непублічних додатків
  USER_TOKEN: process.env.ALTEGIO_USER_TOKEN?.trim() || "",
  // PARTNER_TOKEN - партнерський токен (потрібен тільки для публічних додатків у маркетплейсі)
  // Для непублічного додатку достатньо USER_TOKEN
  PARTNER_TOKEN: process.env.ALTEGIO_PARTNER_TOKEN?.trim() || "",
  // PARTNER_ID - ідентифікатор партнера (може відрізнятися від PARTNER_TOKEN)
  // Якщо не вказано, використовується PARTNER_TOKEN як PARTNER_ID
  PARTNER_ID: process.env.ALTEGIO_PARTNER_ID?.trim() || "",
};

export function assertAltegioEnv() {
  if (!ALTEGIO_ENV.API_URL) {
    throw new Error("Missing env ALTEGIO_API_URL");
  }
  // USER_TOKEN достатньо для роботи (працює для публічних та непублічних додатків)
  // PARTNER_TOKEN потрібен тільки для публічних додатків у маркетплейсі
  if (!ALTEGIO_ENV.USER_TOKEN && !ALTEGIO_ENV.PARTNER_TOKEN) {
    throw new Error("Missing env ALTEGIO_USER_TOKEN or ALTEGIO_PARTNER_TOKEN");
  }
}

/**
 * Заголовки авторизації для Alteg.io API
 * 
 * Примітка: RFC 6749 описує стандартний формат OAuth 2.0: "Bearer <token>"
 * Формат "Bearer <partner_token>, User <user_token>" - це кастомна реалізація Alteg.io
 * і не є частиною стандарту OAuth 2.0.
 * 
 * Формат для USER_TOKEN: "Bearer <user_token>"
 * Формат для PARTNER_TOKEN: "Bearer <partner_token>, User <user_token>"
 */
export function altegioHeaders(includeUserToken = true) {
  assertAltegioEnv();
  
  // Якщо є партнерський токен - використовуємо повний формат
  if (ALTEGIO_ENV.PARTNER_TOKEN) {
    // Partner ID може передаватися окремим заголовком
    // Якщо явно не вказано PARTNER_ID, використовуємо PARTNER_TOKEN як Partner ID
    const partnerId = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.PARTNER_TOKEN;
    
    // Спробуємо різні формати Authorization header:
    // 1. Стандартний: "Bearer <partner_token>, User <user_token>"
    // 2. З Partner ID: "Bearer <partner_token>, User <user_token>, Partner <partner_id>"
    const authParts = [`Bearer ${ALTEGIO_ENV.PARTNER_TOKEN}`];
    
    if (includeUserToken && ALTEGIO_ENV.USER_TOKEN) {
      authParts.push(`User ${ALTEGIO_ENV.USER_TOKEN}`);
    }
    
    // Додаємо Partner ID в Authorization header (альтернативний варіант)
    // Можливо, API очікує Partner ID саме тут
    if (partnerId && partnerId !== ALTEGIO_ENV.PARTNER_TOKEN) {
      authParts.push(`Partner ${partnerId}`);
    }
    
    const authHeader = authParts.join(", ");
    
    // Логування для діагностики
    console.log('[altegio/env] Authorization header:', {
      format: 'Bearer <partner_token>, User <user_token>',
      partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN.length,
      partnerId: partnerId,
      partnerIdLength: partnerId.length,
      userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
      authHeaderPreview: authHeader.substring(0, 50) + '...',
    });
    
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader,
    };
    
    // Додаємо Partner ID як окремий заголовок (якщо потрібно)
    // API може вимагати Partner ID в окремому заголовку або query параметрі
    if (partnerId) {
      // Спробуємо різні варіанти заголовків (API може очікувати будь-який з них)
      headers['X-Partner-ID'] = partnerId;
      headers['Partner-ID'] = partnerId;
      headers['X-Partner-Id'] = partnerId;
      headers['X-PartnerId'] = partnerId;
      headers['PartnerId'] = partnerId;
      // Також спробуємо в Authorization header як окремий параметр
      // Можливо, формат має бути: "Bearer <partner_token>, User <user_token>, Partner <partner_id>"
      // Але спочатку спробуємо стандартний формат
    }
    
    // Логування всіх заголовків для діагностики
    console.log('[altegio/env] Headers with Partner ID:', {
      authorization: authHeader.substring(0, 80) + '...',
      partnerIdHeaders: {
        'X-Partner-ID': headers['X-Partner-ID'],
        'Partner-ID': headers['Partner-ID'],
        'X-Partner-Id': headers['X-Partner-Id'],
      },
      allHeaderKeys: Object.keys(headers),
    });
    
    return headers;
  }
  
  // Для непублічних додатків (або без PARTNER_TOKEN): використовуємо тільки USER_TOKEN
  // Формат: "Bearer <user_token>" (стандартний OAuth 2.0)
  if (ALTEGIO_ENV.USER_TOKEN) {
    const authHeader = `Bearer ${ALTEGIO_ENV.USER_TOKEN}`;
    
    console.log('[altegio/env] Authorization header (USER_TOKEN only):', {
      format: 'Bearer <user_token>',
      userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
    });
    
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader,
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

