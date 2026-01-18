// web/lib/altegio/client.ts
// Базовий HTTP-клієнт для Alteg.io API з retry логікою та rate limiting

import { altegioUrl, altegioHeaders, ALTEGIO_ENV } from './env';

export type AltegioResponse<T = any> = {
  success?: boolean;
  data?: T;
  meta?: any;
  error?: string;
};

export class AltegioHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly retryAfter: string | null;

  constructor(status: number, statusText: string, body: string, retryAfter: string | null) {
    const prefix = `Altegio ${status} ${statusText}`.trim();
    super(body ? `${prefix}: ${body}` : prefix);
    this.name = "AltegioHttpError";
    this.status = status;
    this.responseBody = body;
    this.retryAfter = retryAfter;
  }
}

/**
 * Базовий клієнт для Alteg.io API з retry логікою та rate limiting
 * Rate limit: 200 запитів/хвилину або 5/секунду
 */
export async function altegioFetch<T = any>(
  path: string,
  options: RequestInit = {},
  retries = 3,
  delay = 200
): Promise<T> {
  let url = altegioUrl(path);
  
  console.log(`[altegio/client] Initial URL: ${url}, path: ${path}`);

  // Лімітуємо debug-логи, щоб не засмічувати файл при масових операціях
  // (особливо для кнопки №47, де може бути сотні викликів).
  // #region agent log
  const __shouldDbg = (() => {
    try {
      // @ts-ignore
      globalThis.__altegioDbgCount = (globalThis.__altegioDbgCount || 0) + 1;
      // @ts-ignore
      return globalThis.__altegioDbgCount <= 8;
    } catch {
      return false;
    }
  })();
  const __dbg = (payload: any) => {
    if (!__shouldDbg) return;
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'debug-session', runId: 'altegio-fetch', timestamp: Date.now(), ...payload }),
    }).catch(() => {});
  };
  // #endregion agent log
  
  // Partner ID може передаватися як query параметр або окремий заголовок
  // Для публічних програм: якщо є PARTNER_TOKEN
  // Для непублічних програм: якщо є APPLICATION_ID або PARTNER_ID (ID філії)
  const hasPartnerToken = !!ALTEGIO_ENV.PARTNER_TOKEN;
  const applicationId = ALTEGIO_ENV.APPLICATION_ID || '';
  const partnerId = ALTEGIO_ENV.PARTNER_ID || applicationId || (hasPartnerToken ? ALTEGIO_ENV.PARTNER_TOKEN : '');
  
  // НЕ додаємо partner_id в query для endpoint'ів з company_id в URL
  // (бо company_id вже вказує на конкретну філію, і partner_id може конфліктувати)
  const hasCompanyIdInPath = /\/company\/\d+/.test(path);
  
  // Додаємо Partner ID як query параметр тільки якщо:
  // 1. Є Partner ID
  // 2. URL не містить partner_id вже
  // 3. URL не містить company_id в шляху (бо тоді company_id вже вказує на філію)
  if (partnerId && !url.includes('partner_id=') && !url.includes('partnerId=') && !hasCompanyIdInPath) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}partner_id=${encodeURIComponent(partnerId)}`;
    console.log(`[altegio/client] Added partner_id to URL: ${url}`);
  } else {
    console.log(`[altegio/client] Skipped partner_id: hasCompanyIdInPath=${hasCompanyIdInPath}, url already has partner_id=${url.includes('partner_id=')}`);
  }

  __dbg({
    hypothesisId: 'A1',
    location: 'web/lib/altegio/client.ts:altegioFetch:init',
    message: 'Altegio fetch init (sanitized)',
    data: {
      path,
      method: (options.method || 'GET').toString(),
      baseUrl: ALTEGIO_ENV.API_URL,
      finalUrlHasPartnerId: url.includes('partner_id='),
      hasCompanyIdInPath,
      hasPartnerToken,
      hasUserToken: !!ALTEGIO_ENV.USER_TOKEN,
      userTokenLen: ALTEGIO_ENV.USER_TOKEN ? ALTEGIO_ENV.USER_TOKEN.length : 0,
      partnerTokenLen: ALTEGIO_ENV.PARTNER_TOKEN ? ALTEGIO_ENV.PARTNER_TOKEN.length : 0,
      partnerIdLen: partnerId ? String(partnerId).length : 0,
    },
  });
  
  const headers = altegioHeaders();
  // Важливо: наші заголовки (Accept, Authorization) мають пріоритет
  // options.headers може додати додаткові заголовки, але не перезаписувати обов'язкові
  const finalHeaders = {
    ...headers,
    ...options.headers,
    // Гарантуємо, що Accept header завжди присутній
    Accept: headers.Accept || "application/vnd.api.v2+json",
    Authorization: headers.Authorization || headers.Authorization,
  };

  let lastError: AltegioHttpError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Затримка між повторними спробами
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }

      // Детальне логування для діагностики
      console.log('[altegio/client] Making request:', {
        url,
        programType: hasPartnerToken ? 'Public (with Partner Token)' : 'Non-public (User Token only)',
        urlWithParams: url.includes('partner_id') ? '✅ Partner ID in URL' : '❌ No Partner ID in URL (OK for non-public)',
        headers: Object.keys(finalHeaders),
        acceptHeader: finalHeaders['Accept'] || '❌ MISSING!',
        hasAcceptHeader: !!finalHeaders['Accept'],
        hasPartnerToken,
        hasPartnerId: !!partnerId,
        partnerIdValue: partnerId ? partnerId.substring(0, 10) + '...' : 'not set (OK for non-public)',
        authorizationHeader: finalHeaders['Authorization']?.substring(0, 80) + '...',
        partnerIdHeaders: {
          'X-Partner-ID': finalHeaders['X-Partner-ID'],
          'Partner-ID': finalHeaders['Partner-ID'],
          'X-Partner-Id': finalHeaders['X-Partner-Id'],
          'X-PartnerId': finalHeaders['X-PartnerId'],
          'Authorization': finalHeaders['Authorization']?.includes('Partner') ? 'Contains Partner ID' : 'No Partner ID in Auth',
        },
      });
      
      const response = await fetch(url, {
        ...options,
        headers: finalHeaders,
        cache: 'no-store',
      });

      __dbg({
        hypothesisId: 'A2',
        location: 'web/lib/altegio/client.ts:altegioFetch:response',
        message: 'Altegio response (sanitized)',
        data: {
          path,
          status: response.status,
          ok: response.ok,
          retryAfter: response.headers.get('retry-after') || response.headers.get('Retry-After') || null,
        },
      });

      // Обробка rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        console.warn(`[altegio] Rate limited, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue; // Повторюємо спробу
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = new AltegioHttpError(
          response.status,
          response.statusText,
          body,
          response.headers.get('retry-after')
        );

        // Якщо помилка не 5xx або 429, не повторюємо
        if (response.status < 500 && response.status !== 429) {
          throw lastError;
        }

        // Для 5xx помилок повторюємо
        if (attempt < retries) {
          continue;
        }
        throw lastError;
      }

      // Успішна відповідь
      const json = await response.json().catch(() => ({}));
      return json as T;
    } catch (err) {
      __dbg({
        hypothesisId: 'A3',
        location: 'web/lib/altegio/client.ts:altegioFetch:error',
        message: 'Altegio fetch error (sanitized)',
        data: {
          path,
          errName: err instanceof Error ? err.name : typeof err,
          status: err instanceof AltegioHttpError ? err.status : null,
          isEnvError:
            err instanceof Error
              ? err.message.includes('ALTEGIO_USER_TOKEN') ||
                err.message.includes('ALTEGIO_PARTNER_TOKEN') ||
                err.message.includes('Missing env')
              : false,
        },
      });
      if (err instanceof AltegioHttpError) {
        lastError = err;
        if (attempt < retries && (err.status >= 500 || err.status === 429)) {
          continue;
        }
        throw err;
      }

      // Інші помилки (мережа, тощо)
      if (attempt < retries) {
        lastError = new AltegioHttpError(0, 'Network Error', String(err), null);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to fetch after retries');
}

