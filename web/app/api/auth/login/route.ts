// web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, createUserSessionCookie } from '@/lib/auth-rbac';

type LoginPayload =
  | { password?: string; login?: string }
  | { admin?: string }
  | Record<string, unknown>;

/**
 * Приймає JSON { login, password } для AppUser або { password } для ADMIN_PASS
 * При успіху — встановлює куку admin_token
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

  let body: LoginPayload = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      body = (await req.json()) as LoginPayload;
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      body = {
        login: String(form.get('login') || ''),
        password: String(form.get('password') || ''),
      };
    } else {
      body = (await req.json().catch(() => ({}))) as LoginPayload;
    }
  } catch {
    body = {};
  }

  const login = (body as any)?.login ? String((body as any).login).trim() : '';
  const password = (body as any)?.password ?? (body as any)?.pass ?? (body as any)?.admin ?? (body as any)?.token ?? '';

  if (typeof password !== 'string' || !password) {
    return NextResponse.json(
      { ok: false, error: 'Пароль обовʼязковий' },
      { status: 400 }
    );
  }

  // 1) Логін через AppUser (login + password)
  if (login) {
    try {
      const user = await prisma.appUser.findUnique({
        where: { login, isActive: true },
        include: { function: true },
      });
      if (user && (await verifyPassword(password, user.passwordHash))) {
        const res = NextResponse.json({ ok: true, userId: user.id, name: user.name });
        const cookieValue = createUserSessionCookie(user.id);
        res.cookies.set('admin_token', cookieValue, {
          path: '/',
          httpOnly: false,
          secure: isHttps,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7, // 7 днів
        });
        return res;
      }
    } catch (err) {
      console.error('[auth/login] AppUser login error:', err);
    }
    return NextResponse.json(
      { ok: false, error: 'Невірний логін або пароль' },
      { status: 401 }
    );
  }

  // 2) Логін через ADMIN_PASS (супер-адмін)
  if (!ADMIN) {
    return NextResponse.json(
      { ok: false, error: 'ADMIN_PASS не налаштовано на сервері' },
      { status: 500 }
    );
  }

  const incoming = typeof password === 'string' ? password : '';
  if (incoming !== ADMIN) {
    return NextResponse.json(
      { ok: false, error: 'Невірний пароль' },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_token', incoming, {
    path: '/',
    httpOnly: false,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 днів
  });
  return res;
}
