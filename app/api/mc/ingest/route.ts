// app/api/mc/ingest/route.ts
// ЩО РОБИТЬ ЦЕЙ КОД:
// - Прибирає проблемний імпорт kcGetCardState (через який падав білд).
// - Перевіряє MC_TOKEN (Bearer або ?token=).
// - Нормалізує username/fullname/text з ManyChat payload.
// - Повертає echo-відповідь + (опційно) пише короткий лог у KV.
// Далі, коли збірка пройде, повернемось і додамо пошук/рух карток.

import { NextResponse } from 'next/server';
import { kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

function normUsername(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/^@/, '').toLowerCase();
}
function normFullname(raw?: string): string | undefined {
  const s = raw?.trim();
  return s ? s : undefined;
}

export async function POST(req: Request) {
  // ===== 1) Auth guard (MC_TOKEN) =====
  const url = new URL(req.url);
  const bearer = req.headers.get('authorization') || '';
  const headerToken = bearer.replace(/^Bearer\s+/i, '').trim();
  const queryToken = url.searchParams.get('token') || '';
  const provided = headerToken || queryToken;
  const expected = process.env.MC_TOKEN || '';

  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // ===== 2) Parse & normalize payload =====
  const body = (await req.json().catch(() => ({}))) as any;

  // ManyChat може надсилати такі поля:
  // { username, text, full_name, name, first_name, last_name, last_input_text }
  const username =
    normUsername(
      body.username ??
        body.ig_username ??
        body.instagram_username ??
        body.handle ??
        ''
    ) || '';

  const text = String(body.text ?? body.last_input_text ?? '').trim();

  const fullnameCandidate =
    body.full_name ??
    body.name ??
    [body.first_name, body.last_name].filter(Boolean).join(' ');
  const fullname = normFullname(fullnameCandidate) || '';

  // ===== 3) (optional) lightweight log to KV =====
  try {
    await kvSet('logs:last:mc:ingest', {
      ts: Date.now(),
      username,
      text,
      fullname,
      src: 'mc/ingest',
    });
  } catch {
    // лог — best-effort, помилки ігноруємо
  }

  // ===== 4) Echo response (тимчасово, щоб пройти збірку) =====
  return NextResponse.json({
    ok: true,
    normalized: { username, text, fullname },
    note: 'ingest stub: build unblocked; next step will add search+move',
  });
}
