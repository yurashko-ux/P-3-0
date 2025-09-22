// web/lib/auth.ts
// Проста адмін-охорона: Authorization: Bearer 11111 або ?pass=11111
// Повертаємо зрозумілу 401-помилку, щоб /api/campaigns не падало 500-кою.

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '11111';

function readAuthHeader(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  // дозволимо як "Bearer 11111", так і просто "11111"
  const trimmed = h.trim();
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, '');
  return trimmed;
}

export async function assertAdmin(req: Request): Promise<void> {
  // 1) Bearer/Authorization
  const headerToken = readAuthHeader(req);
  if (headerToken && headerToken === ADMIN_TOKEN) return;

  // 2) ?pass=...
  try {
    const url = new URL(req.url);
    const pass = url.searchParams.get('pass');
    if (pass && pass === ADMIN_TOKEN) return;
  } catch {
    /* ignore malformed URL */
  }

  // Якщо не пройшли — кидаємо помилку З ЧІТКИМ ТЕКСТОМ "Unauthorized"
  const e = new Error('Unauthorized: missing or invalid admin token');
  // @ts-expect-error — runtime-only прапорець, корисний для маршрутизатора
  e.statusCode = 401;
  throw e;
}
