// web/lib/auth.ts
// Адмін-охорона: приймаємо токен з (1) Authorization, (2) ?pass=, (3) cookie=admin_pass

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '11111';

function readAuthHeader(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const trimmed = h.trim();
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, '');
  return trimmed;
}

function readQueryPass(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const pass = url.searchParams.get('pass');
    return pass || null;
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const all = req.headers.get('cookie');
  if (!all) return null;
  // простий парсер cookie
  const parts = all.split(/; */);
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    if (decodeURIComponent(k.trim()) === name) {
      return decodeURIComponent(rest.join('=').trim());
    }
  }
  return null;
}

export async function assertAdmin(req: Request): Promise<void> {
  // 1) Authorization header
  const headerToken = readAuthHeader(req);
  if (headerToken && headerToken === ADMIN_TOKEN) return;

  // 2) ?pass=...
  const pass = readQueryPass(req);
  if (pass && pass === ADMIN_TOKEN) return;

  // 3) cookie: admin_pass
  const cookiePass = readCookie(req, 'admin_pass');
  if (cookiePass && cookiePass === ADMIN_TOKEN) return;

  const e = new Error('Unauthorized: missing or invalid admin token');
  // @ts-expect-error add status
  e.statusCode = 401;
  throw e;
}
