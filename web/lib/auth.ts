// web/lib/auth.ts
// Проста авторизація: Bearer <ADMIN_PASS> або ?pass=... у query.
// За замовчуванням ADMIN_PASS="11111" (як у твоїх прикладах).

import type { NextRequest } from 'next/server';

const ADMIN_PASS = process.env.ADMIN_PASS || '11111';

export async function assertAdmin(req: NextRequest | Request): Promise<void> {
  // 1) Authorization: Bearer <token>
  const authHeader =
    (req as any).headers?.get?.('authorization') ??
    (req as any).headers?.get?.('Authorization') ??
    '';

  let token =
    authHeader && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  // 2) ?pass=...
  if (!token) {
    const url = new URL((req as any).url);
    const q = url.searchParams.get('pass')?.trim();
    if (q) token = q;
  }

  if (!token || token !== ADMIN_PASS) {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}
