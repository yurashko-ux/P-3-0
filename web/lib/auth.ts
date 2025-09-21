// web/lib/auth.ts
/**
 * Minimal admin guard used by API routes.
 * Allows either:
 *  - Authorization: Bearer <ADMIN_PASS>
 *  - ?pass=<ADMIN_PASS> in query string
 *
 * ADMIN_PASS defaults to '11111' if not provided.
 */
export function assertAdmin(req: Request) {
  const url = new URL(req.url);
  const qpass = url.searchParams.get('pass') ?? '';

  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1] ?? '';

  const ADMIN_PASS = process.env.ADMIN_PASS ?? '11111';
  const ok = qpass === ADMIN_PASS || bearer === ADMIN_PASS;

  if (!ok) {
    throw new Response('Unauthorized', { status: 401 });
  }
}
