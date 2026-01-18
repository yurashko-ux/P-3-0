// web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

type LoginPayload =
  | { password?: string }
  | { admin?: string }
  | Record<string, unknown>;

/**
 * Приймає JSON { password: "..."} або { admin: "..." }
 * Якщо співпадає з ADMIN_PASS — ставить куку admin_token і повертає {ok:true}
 */
export async function POST(req: Request) {
  const ADMIN = process.env.ADMIN_PASS || '';

  // якщо пароль не налаштовано у середовищі — блокуємо логін
  if (!ADMIN) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'login_issue_pre',
        hypothesisId: 'A1',
        location: 'web/app/api/auth/login/route.ts:POST',
        message: 'Login blocked: ADMIN_PASS missing on server',
        data: { urlHost: (() => { try { return new URL(req.url).host; } catch { return null; } })() },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log
    return NextResponse.json(
      { ok: false, error: 'ADMIN_PASS is not set on server' },
      { status: 500 }
    );
  }

  let body: LoginPayload = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      body = (await req.json()) as LoginPayload;
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      body = { password: String(form.get('password') || '') };
    } else {
      // спробуємо як JSON на всяк випадок
      body = (await req.json().catch(() => ({}))) as LoginPayload;
    }
  } catch {
    // ігноруємо — нижче просто не буде пароля
  }

  const incoming =
    (body as any)?.password ??
    (body as any)?.admin ??
    (body as any)?.token ??
    '';

  if (typeof incoming !== 'string' || !incoming) {
    return NextResponse.json(
      { ok: false, error: 'Password is required' },
      { status: 400 }
    );
  }

  if (incoming !== ADMIN) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'login_issue_pre',
        hypothesisId: 'A2',
        location: 'web/app/api/auth/login/route.ts:POST',
        message: 'Login failed: invalid password',
        data: { incomingLen: String(incoming || '').length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log
    return NextResponse.json(
      { ok: false, error: 'Invalid password' },
      { status: 401 }
    );
  }

  // Успіх: ставимо куку admin_token
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'login_issue_pre',
      hypothesisId: 'A3',
      location: 'web/app/api/auth/login/route.ts:POST',
      message: 'Login success: setting admin_token cookie',
      data: {
        incomingLen: String(incoming || '').length,
        cookieSecure: true,
        urlHost: (() => { try { return new URL(req.url).host; } catch { return null; } })(),
        urlProto: (() => { try { return new URL(req.url).protocol; } catch { return null; } })(),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_token', incoming, {
    path: '/',
    httpOnly: false, // дозволяємо читати на клієнті, бо UI може підставляти заголовок
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}
