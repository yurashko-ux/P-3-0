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
  const isHttps = (() => {
    try {
      const xfProto = (req.headers.get('x-forwarded-proto') || '').toLowerCase();
      const proto = new URL(req.url).protocol;
      return proto === 'https:' || xfProto === 'https';
    } catch {
      return true;
    }
  })();

  // якщо пароль не налаштовано у середовищі — блокуємо логін
  if (!ADMIN) {
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
    (body as any)?.pass ??
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
    return NextResponse.json(
      { ok: false, error: 'Invalid password' },
      { status: 401 }
    );
  }

  // Успіх: ставимо куку admin_token
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_token', incoming, {
    path: '/',
    httpOnly: false, // дозволяємо читати на клієнті, бо UI може підставляти заголовок
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}
