// web/app/api/auth/me/route.ts
// Поточний користувач та permissions (для фронту)

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-rbac';

export async function GET(req: Request) {
  const auth = await getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: auth.type === 'superadmin'
      ? { type: 'superadmin', name: 'Супер-адмін', userId: null }
      : { type: 'user', name: auth.userName, userId: auth.userId },
    permissions: auth.permissions,
  });
}
