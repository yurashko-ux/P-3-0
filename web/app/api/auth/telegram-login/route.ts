// web/app/api/auth/telegram-login/route.ts
// Вхід через Telegram Login Widget — перевірка hash, пошук user за telegram_user_id

import { NextResponse } from 'next/server';
import { createHmac, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { createUserSessionToken } from '@/lib/auth-rbac';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_LOGIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';

type TelegramAuthPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

function verifyTelegramHash(payload: TelegramAuthPayload): boolean {
  if (!TELEGRAM_BOT_TOKEN || !payload.hash) return false;

  const { hash, ...data } = payload;
  const dataCheckString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${(data as any)[k]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return computedHash === hash;
}

export async function POST(req: Request) {
  const isHttps = (() => {
    try {
      const xfProto = req.headers.get('x-forwarded-proto') || '';
      const proto = new URL(req.url).protocol;
      return proto === 'https:' || xfProto === 'https';
    } catch {
      return true;
    }
  })();

  let body: TelegramAuthPayload;
  try {
    body = (await req.json()) as TelegramAuthPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Невірний JSON' }, { status: 400 });
  }

  if (!body.id || !body.auth_date || !body.hash) {
    return NextResponse.json({ ok: false, error: 'Відсутні обовʼязкові поля (id, auth_date, hash)' }, { status: 400 });
  }

  if (!verifyTelegramHash(body)) {
    return NextResponse.json({ ok: false, error: 'Невірний hash або застарілі дані' }, { status: 401 });
  }

  const telegramUserId = BigInt(body.id);

  const user = await prisma.appUser.findFirst({
    where: { telegramUserId, isActive: true },
    include: { function: true },
  });

  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Користувач не знайдений. Звʼяжіться з адміністратором для доступу.' },
      { status: 404 }
    );
  }

  const cookieValue = createUserSessionToken(user.id);
  const res = NextResponse.json({ ok: true, userId: user.id, name: user.name });
  res.cookies.set('admin_token', cookieValue, {
    path: '/',
    httpOnly: false,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
