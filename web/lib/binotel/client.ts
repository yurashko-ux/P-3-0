// web/lib/binotel/client.ts
// Клієнт API Binotel для інтеграції з Direct Manager

const BINOTEL_API_BASE = "https://api.binotel.com/api/4.0";

/** Відповідь Binotel API (успіх) */
export interface BinotelSuccessResponse<T = unknown> {
  status: "success";
  [key: string]: T | string;
}

/** Відповідь Binotel API (помилка) */
export interface BinotelErrorResponse {
  status: string;
  code?: string;
  message?: string;
}

export type BinotelResponse<T = unknown> =
  | BinotelSuccessResponse<T>
  | BinotelErrorResponse;

/** Перевіряє, чи відповідь успішна */
export function isBinotelSuccess(
  r: BinotelResponse
): r is BinotelSuccessResponse {
  return r?.status === "success";
}

/**
 * Відправляє запит до Binotel API.
 * POST на https://api.binotel.com/api/4.0/{endpoint}.json
 * з key та secret у body.
 */
export async function sendRequest<T = unknown>(
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<BinotelResponse<T>> {
  const key = process.env.BINOTEL_API_KEY?.trim();
  const secret = process.env.BINOTEL_API_SECRET?.trim();

  if (!key || !secret) {
    throw new Error(
      "BINOTEL_API_KEY та BINOTEL_API_SECRET мають бути встановлені в ENV"
    );
  }

  const url = `${BINOTEL_API_BASE}/${endpoint.replace(/\.json$/, "")}.json`;
  const body = { ...params, key, secret };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as BinotelResponse<T>;

  if (!res.ok) {
    return {
      status: "error",
      code: String(res.status),
      message: (data as BinotelErrorResponse).message || res.statusText,
    };
  }

  return data;
}
