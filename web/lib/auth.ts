// web/lib/auth.ts
import { NextRequest } from 'next/server';

// Use ENV in prod, fallback for dev
const ADMIN_PASS = process.env.ADMIN_PASS || '11111';

// Throws if not authorized
export async function assertAdmin(req: NextRequest): Promise<void> {
  const h = req.headers.get('authorization') || '';
  const bearer =
    h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;

  // also allow ?pass= for quick cURL tests
  const urlPass = (req as any).nextUrl?.searchParams?.get('pass');

  if (bearer === ADMIN_PASS || urlPass === ADMIN_PASS) return;

  throw new Error('Unauthorized');
}
