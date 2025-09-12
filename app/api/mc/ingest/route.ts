// app/api/mc/ingest/route.ts
// 🔧 Stub-версія ендпойнта для ManyChat, ЩОБ ЗІБРАТИСЯ БЕЗ ПОМИЛОК.
// - ЖОДНИХ імпортів із '@/lib/keycrm' (в т.ч. kcGetCardState) — саме це ламало білд.
// - Перевірка MC_TOKEN (Bearer або ?token=).
// - Нормалізація username/fullname/text.
// - Повертаємо JSON; інтеграцію з KV/KeyCRM додамо наступним кроком.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normUsername(raw?: unknown): string {
  if (!raw) return '';
  return String(raw).trim().replace(/^@/, '').toLowerCase();
}
function normFullname(raw?: unknown): string {
  return String(raw ?? '').trim();
}

export async function POST(req: Request) {
  // 1) Auth guard (MC_TOKEN з Bearer або ?token=)
  const url = new URL(req.url);
  const bearer = req.headers.get('authorization') || '';
  const headerToken = bearer.replace(/^Bearer\s+/i, '').trim();
  const queryToken = url.searchParams.get('token') || '';
  const provided = headerToken || queryToken;
  const expected = process.env.MC_TOKEN || '';

  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2) Parse body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore parse error → body = {}
  }

  // 3) Normalize fields from ManyChat
  const username =
    normUsername(
      body.username ??
        body.ig_username ??
        body.instagram_username ??
        body.handle ??
        ''
    );

  const text = String(body.text ?? body.last_input_text ?? '').trim();

  const fullnameCandidate =
    body.full_name ??
    body.name ??
    [body.first_name, body.last_name].filter(Boolean).join(' ');
  const fullname = normFullname(fullnameCandidate);

  // 4) Respond (stub)
  return NextResponse.json({
    ok: true,
    normalized: { username, text, fullname },
    note: 'ingest stub: imports to KeyCRM removed to fix build',
  });
}
