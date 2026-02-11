// web/lib/altegio/client.ts
// Базовий HTTP-клієнт для Alteg.io API з retry логікою та rate limiting
// Детальні логи (URL, заголовки) виводяться тільки при DEBUG_ALTEGIO=1

import { altegioUrl, altegioHeaders, ALTEGIO_ENV } from './env';

const DEBUG_ALTEGIO = process.env.DEBUG_ALTEGIO === '1' || process.env.DEBUG_ALTEGIO === 'true';

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

  if (DEBUG_ALTEGIO) {
    console.log(`[altegio/client] Initial URL: ${url}, path: ${path}`);
  }

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
    if (DEBUG_ALTEGIO) console.log(`[altegio/client] Added partner_id to URL: ${url}`);
  } else if (DEBUG_ALTEGIO) {
    console.log(`[altegio/client] Skipped partner_id: hasCompanyIdInPath=${hasCompanyIdInPath}, url already has partner_id=${url.includes('partner_id=')}`);
  }

  const headers = altegioHeaders();
  // Важливо: наші заголовки (Accept, Authorization) мають пріоритет
  // options.headers може додати додаткові заголовки, але не перезаписувати обов'язкові
  // Accept: application/vnd.api.v2+json — використовується для v1 endpoints (GET /visits/{id}, GET /records).
  // Документація Altegio використовує цей заголовок у curl-прикладах, v1 API його підтримує.
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

      if (DEBUG_ALTEGIO) {
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
      }

      const response = await fetch(url, {
        ...options,
        headers: finalHeaders,
        cache: 'no-store',
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

