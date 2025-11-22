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
  
  // Partner ID може передаватися як query параметр або окремий заголовок
  // Отримуємо Partner ID з env (якщо є PARTNER_ID, використовуємо його, інакше PARTNER_TOKEN)
  const partnerId = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.PARTNER_TOKEN || '';
  
  // Додаємо Partner ID як query параметр (якщо потрібно)
  if (partnerId && !url.includes('partner_id=') && !url.includes('partnerId=')) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}partner_id=${encodeURIComponent(partnerId)}`;
  }
  
  const headers = altegioHeaders();
  const finalHeaders = {
    ...headers,
    ...options.headers,
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
        urlWithParams: url.includes('partner_id') ? '✅ Partner ID in URL' : '❌ No Partner ID in URL',
        headers: Object.keys(finalHeaders),
        hasPartnerId: !!partnerId,
        partnerIdValue: partnerId ? partnerId.substring(0, 10) + '...' : 'not set',
        authorizationHeader: finalHeaders['Authorization']?.substring(0, 80) + '...',
        partnerIdHeaders: {
          'X-Partner-ID': finalHeaders['X-Partner-ID'],
          'Partner-ID': finalHeaders['Partner-ID'],
          'X-Partner-Id': finalHeaders['X-Partner-Id'],
        },
      });
      
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

