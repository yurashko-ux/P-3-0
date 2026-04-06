// web/app/api/auth/me/route.ts
// Поточний користувач та permissions (для фронту)

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-rbac';

export async function GET(req: Request) {
  const auth = await getAuthContext(req);
  // 200 замість 401: фронт перевіряє data.ok; так менше «червоних» записів у DevTools без втрати сенсу.
  if (!auth) {
    return NextResponse.json({ ok: false, user: null, permissions: null });
  }

  return NextResponse.json({
    ok: true,
    user: auth.type === 'superadmin'
      ? { type: 'superadmin', name: 'Супер-адмін', login: 'admin', userId: null }
      : { type: 'user', name: auth.userName, login: auth.login, userId: auth.userId },
    permissions: auth.permissions,
  });
}
