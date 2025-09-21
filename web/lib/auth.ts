// web/lib/auth.ts
import { NextRequest } from 'next/server';

/**
 * Проста адмін-авторизація:
 *  - Header:  Authorization: Bearer 11111
 *  - або query: ?pass=11111  (для ручних перевірок у браузері)
 *
 * Значення пароля береться з ENV ADMIN_PASS або за замовчуванням "11111".
 */
function expectedPass(): string {
  return process.env.ADMIN_PASS?.trim() || '11111';
}

function readBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function readQueryPass(req: NextRequest): string | null {
  try {
    return req.nextUrl.searchParams.get('pass')?.trim() || null;
  } catch {
    // на всяк випадок fallback через стандартний URL
    try {
      const u = new URL(req.url);
      return u.searchParams.get('pass')?.trim() || null;
    } catch {
      return null;
    }
  }
}

export async function assertAdmin(req: NextRequest): Promise<void> {
  const want = expectedPass();
  const got = readBearer(req) || readQueryPass(req);
  if (!got || got !== want) {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

// опційно: щоб швидко перевіряти в UI/діагностиці без кидання помилки
export async function isAdmin(req: NextRequest): Promise<boolean> {
  try {
    await assertAdmin(req);
    return true;
  } catch {
    return false;
  }
}
