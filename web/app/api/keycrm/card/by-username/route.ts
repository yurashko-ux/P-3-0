// web/app/api/keycrm/card/by-username/route.ts
// Повертає card_id з локальних індексів за IG username (із @ або без).
// Авторизація м'яка: Bearer ADMIN_PASS або ?pass=... (для ручних перевірок)

import { NextRequest, NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';
import { assertAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if ((expected && bearer === expected) || (expected && passParam === expected)) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const username = url.searchParams.get('username') || url.searchParams.get('handle') || '';

    if (!username.trim()) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }

    // ✅ Нова сигнатура: лише 1 аргумент
    const found = await findCardIdByUsername(username);

    return NextResponse.json(
      { ok: true, found_card_id: found ?? null, used: { username } },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 400 }
    );
  }
}
