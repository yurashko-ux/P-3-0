// web/lib/altegio/client.ts
// Базовий HTTP-клієнт для Alteg.io API з retry логікою та rate limiting

import { altegioUrl, altegioHeaders } from './env';

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
  const url = altegioUrl(path);
  const headers = {
    ...altegioHeaders(),
    ...options.headers,
  };

  let lastError: AltegioHttpError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Затримка між повторними спробами
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }

      const response = await fetch(url, {
        ...options,
        headers,
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

