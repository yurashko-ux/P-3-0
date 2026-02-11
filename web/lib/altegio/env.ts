// web/lib/altegio/env.ts
// Окрема конфігурація для Alteg.io API (не залежить від KeyCRM)
// Детальні логи (токени, заголовки) виводяться тільки при DEBUG_ALTEGIO=1

const ALTEGIO_DEFAULT_API_URL = "https://api.alteg.io/api/v1";
const DEBUG_ALTEGIO = process.env.DEBUG_ALTEGIO === '1' || process.env.DEBUG_ALTEGIO === 'true';

export const ALTEGIO_ENV = {
  API_URL: process.env.ALTEGIO_API_URL?.trim() || ALTEGIO_DEFAULT_API_URL,
  // USER_TOKEN - токен користувача, отримується в розділі "Доступ до API" маркетплейсу
  // Працює як для публічних, так і для непублічних додатків
  USER_TOKEN: process.env.ALTEGIO_USER_TOKEN?.trim() || "",
  // PARTNER_TOKEN - партнерський токен (потрібен тільки для публічних додатків у маркетплейсі)
  // Для непублічного додатку достатньо USER_TOKEN
  PARTNER_TOKEN: process.env.ALTEGIO_PARTNER_TOKEN?.trim() || "",
  // PARTNER_ID - може бути:
  // 1. ID філії/салону в Alteg.io (для непублічних програм) - наприклад, 1169323
  // 2. Application ID (для публічних програм) - наприклад, 1193
  // API використовує Partner ID, щоб знати, з якої філії брати дані
  PARTNER_ID: process.env.ALTEGIO_PARTNER_ID?.trim() || "",
  // APPLICATION_ID - ID програми в маркетплейсі (для непублічних програм)
  // Може відрізнятися від Partner ID (ID філії)
  // Якщо не вказано, використовується PARTNER_ID
  APPLICATION_ID: process.env.ALTEGIO_APPLICATION_ID?.trim() || "",
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
  
  // ВАЖЛИВО: Згідно з техпідтримкою Altegio, User_token обов'язковий для доступу до location
  // Завжди перевіряємо, що USER_TOKEN присутній
  if (!ALTEGIO_ENV.USER_TOKEN) {
    throw new Error("ALTEGIO_USER_TOKEN is required. Please set it in environment variables.");
  }
  
  if (DEBUG_ALTEGIO) {
    console.log('[altegio/env] Token check:', {
      hasUserToken: !!ALTEGIO_ENV.USER_TOKEN,
      userTokenLength: ALTEGIO_ENV.USER_TOKEN?.length || 0,
      hasPartnerToken: !!ALTEGIO_ENV.PARTNER_TOKEN,
      partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN?.length || 0,
      hasApplicationId: !!ALTEGIO_ENV.APPLICATION_ID,
      applicationId: ALTEGIO_ENV.APPLICATION_ID || 'not set',
      hasPartnerId: !!ALTEGIO_ENV.PARTNER_ID,
      partnerId: ALTEGIO_ENV.PARTNER_ID || 'not set',
    });
  }

  // НЕПУБЛІЧНІ ПРОГРАМИ: Якщо є Partner Token, використовуємо його разом з User Token
  // Partner Token може бути присутній і для непублічних програм
  // Якщо Partner Token не вказано, використовуємо тільки User Token
  // Для непублічних програм може знадобитися Application ID або числовий Partner ID
  // (в заголовках, але не в Authorization header)
  
  // Якщо є Partner Token (навіть для непублічної програми), спробуємо використати його
  if (ALTEGIO_ENV.PARTNER_TOKEN && ALTEGIO_ENV.USER_TOKEN) {
    // Варіант 1: Формат для публічних програм (може працювати і для непублічних)
    // "Bearer <partner_token>, User <user_token>"
    const authHeader = `Bearer ${ALTEGIO_ENV.PARTNER_TOKEN}, User ${ALTEGIO_ENV.USER_TOKEN}`;
    
    const headers: Record<string, string> = {
      Accept: "application/vnd.api.v2+json",
      "Content-Type": "application/json",
      Authorization: authHeader,
    };
    
    // Для непублічних програм: використовуємо Application ID (1195) якщо є, інакше Partner ID (784)
    // Application ID зазвичай правильніший для непублічних програм
    const applicationId = ALTEGIO_ENV.APPLICATION_ID || '';
    const partnerId = applicationId || ALTEGIO_ENV.PARTNER_ID || '';
    
    if (partnerId) {
      headers['X-Partner-ID'] = partnerId;
      headers['Partner-ID'] = partnerId;
      headers['X-Partner-Id'] = partnerId;
      headers['X-PartnerId'] = partnerId;
      // Також спробуємо додати Application ID як окремий заголовок
      if (applicationId) {
        headers['X-Application-ID'] = applicationId;
        headers['Application-ID'] = applicationId;
      }
    }

    if (DEBUG_ALTEGIO) {
      console.log('[altegio/env] Authorization header (with Partner Token - may be non-public):', {
        format: 'Bearer <partner_token>, User <user_token>',
        programType: 'Non-public (with Partner Token)',
        partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN.length,
        partnerId: partnerId || 'not set',
        userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
        authorizationHeader: authHeader.substring(0, 80) + '...',
        allHeaders: Object.keys(headers),
        note: 'Using Partner Token with User Token (may be for non-public program)',
      });
    }

    return headers;
  }

  // Якщо Partner Token не вказано, використовуємо тільки User Token
  if (!ALTEGIO_ENV.PARTNER_TOKEN && ALTEGIO_ENV.USER_TOKEN) {
    const authHeader = `Bearer ${ALTEGIO_ENV.USER_TOKEN}`;
    
    // Для непублічних програм потрібен Partner ID
    // Може бути: ID філії (1169323) або Application ID (1193)
    // Спробуємо Application ID спочатку, якщо він вказаний, інакше використаємо PARTNER_ID
    const applicationId = ALTEGIO_ENV.APPLICATION_ID || '';
    const partnerId = ALTEGIO_ENV.PARTNER_ID;
    
    // Для непублічних програм API може вимагати Application ID як Partner ID
    // Спробуємо обидва варіанти: Application ID або Partner ID (ID філії)
    const partnerIdToUse = applicationId || partnerId;
    
    const headers: Record<string, string> = {
      Accept: "application/vnd.api.v2+json",
      "Content-Type": "application/json",
      Authorization: authHeader,
    };
    
    // Якщо є Partner ID (Application ID або ID філії), спробуємо різні варіанти передачі
    if (partnerIdToUse) {
      // Варіант 1: Формат для публічних програм (можливо працює і для непублічних)
      // "Bearer <application_id>, User <user_token>"
      const authHeaderAsPublic = `Bearer ${partnerIdToUse}, User ${ALTEGIO_ENV.USER_TOKEN}`;
      
      // Варіант 2: Формат "Bearer <user_token>, Partner <partner_id>"
      const authHeaderWithPartner = `${authHeader}, Partner ${partnerIdToUse}`;
      
      // Варіант 3: Додаємо як окремі заголовки
      headers['X-Partner-ID'] = partnerIdToUse;
      headers['Partner-ID'] = partnerIdToUse;
      headers['X-Partner-Id'] = partnerIdToUse;
      headers['X-PartnerId'] = partnerIdToUse;
      
      // Спробуємо формат як для публічних програм (Bearer Application ID, User Token)
      // Це найбільш вірогідний формат, який працює для непублічних програм
      headers['Authorization'] = authHeaderAsPublic;

      if (DEBUG_ALTEGIO) {
        console.log('[altegio/env] Authorization header (Non-public program - trying public format):', {
          format: 'Bearer <application_id>, User <user_token>',
          programType: 'Non-public',
          applicationId: applicationId || 'not set',
          partnerId: partnerId || 'not set',
          usingAsPartnerId: partnerIdToUse,
          userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
          authorizationHeader: authHeaderAsPublic.substring(0, 80) + '...',
          allHeaders: Object.keys(headers),
          note: 'Trying public program format: Bearer <application_id>, User <token>',
        });
      }
    } else if (DEBUG_ALTEGIO) {
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

    if (DEBUG_ALTEGIO) {
      console.log('[altegio/env] Authorization header:', {
        format: 'Bearer <partner_token>, User <user_token>',
        partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN.length,
        partnerId: partnerId,
        partnerIdLength: partnerId.length,
        userTokenLength: ALTEGIO_ENV.USER_TOKEN.length,
        authHeaderPreview: authHeader.substring(0, 50) + '...',
      });
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.api.v2+json",
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

    if (DEBUG_ALTEGIO) {
      console.log('[altegio/env] Headers with Partner ID:', {
        authorization: authHeader.substring(0, 80) + '...',
        partnerIdHeaders: {
          'X-Partner-ID': headers['X-Partner-ID'],
          'Partner-ID': headers['Partner-ID'],
          'X-Partner-Id': headers['X-Partner-Id'],
        },
        allHeaderKeys: Object.keys(headers),
      });
    }

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

