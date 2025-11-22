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
  // PARTNER_ID - ідентифікатор філії/салону в Alteg.io (для непублічних програм)
  // або Application ID / Partner Token (для публічних програм)
  // Для непублічних програм це ID вашої філії в Alteg.io (наприклад, 1169323)
  // API використовує Partner ID, щоб знати, з якої філії брати дані
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
 * Важливо: Згідно з документацією Alteg.io Marketplace:
 * 
 * **Непублічні програми (тільки для вашої філії):**
 * - Використовується тільки USER_TOKEN
 * - Формат: "Bearer <user_token>"
 * - Partner ID не потрібен
 * - Достатньо встановити ALTEGIO_USER_TOKEN
 * 
 * **Публічні програми (для маркетплейсу):**
 * - Використовується PARTNER_TOKEN + USER_TOKEN
 * - Формат: "Bearer <partner_token>, User <user_token>"
 * - Partner ID додається в заголовки та query параметри
 * - Потрібно встановити ALTEGIO_PARTNER_TOKEN та ALTEGIO_USER_TOKEN
 */
export function altegioHeaders(includeUserToken = true) {
  assertAltegioEnv();
  
  // НЕПУБЛІЧНІ ПРОГРАМИ: Якщо Partner Token не вказано, використовуємо тільки User Token
  // Це для непублічних програм, які використовуються тільки для вашої філії
  // Для непублічних програм може знадобитися Application ID як Partner ID
  // (в заголовках, але не в Authorization header)
  if (!ALTEGIO_ENV.PARTNER_TOKEN && ALTEGIO_ENV.USER_TOKEN) {
    const authHeader = `Bearer ${ALTEGIO_ENV.USER_TOKEN}`;
    
    // Для непублічних програм Application ID може бути потрібен як Partner ID
    // Спробуємо використати PARTNER_ID якщо він вказаний (Application ID)
    const partnerId = ALTEGIO_ENV.PARTNER_ID;
    
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader,
    };
    
    // Якщо є PARTNER_ID (Application ID), додаємо його як окремі заголовки
    // для непублічних програм (без використання в Authorization)
    if (partnerId) {
      headers['X-Partner-ID'] = partnerId;
      headers['Partner-ID'] = partnerId;
      headers['X-Partner-Id'] = partnerId;
      
      console.log('[altegio/env] Authorization header (Non-public program - USER_TOKEN + Partner ID):', {
        format: 'Bearer <user_token> + X-Partner-ID header',
        programType: 'Non-public',
        userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
        partnerId: partnerId,
        note: 'Using Application ID as Partner ID in headers (not in Authorization)',
      });
    } else {
      console.log('[altegio/env] Authorization header (Non-public program - USER_TOKEN only):', {
        format: 'Bearer <user_token>',
        programType: 'Non-public',
        userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
        note: 'Partner ID not provided - may need ALTEGIO_PARTNER_ID (Application ID)',
      });
    }
    
    return headers;
  }
  
  // ПУБЛІЧНІ ПРОГРАМИ: Якщо є Partner Token - використовуємо повний формат
  // Це для публічних програм на маркетплейсі
  // Потрібен Partner Token + User Token + Partner ID в заголовках
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
  
  // Якщо досягли сюди - немає ні Partner Token, ні User Token
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

