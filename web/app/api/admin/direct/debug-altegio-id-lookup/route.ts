// web/app/api/admin/direct/debug-altegio-id-lookup/route.ts
// DEBUG: допоміжний ендпойнт щоб зрозуміти, що саме за число принесли (clientId vs recordId)
// на основі KV-логів Altegio (altegio:records:log).
//
// ВАЖЛИВО: не повертаємо PII (імена/телефони), тільки числові ID та структуру.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function unwrapKV(x: any): any {
  try {
    if (x && typeof x === 'object' && 'value' in x && typeof (x as any).value === 'string') {
      return JSON.parse((x as any).value);
    }
  } catch {
    // ignore
  }
  if (typeof x === 'string') {
    try {
      return JSON.parse(x);
    } catch {
      return x;
    }
  }
  return x;
}

const asNum = (v: any): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v || ''), 10);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const idRaw = (req.nextUrl.searchParams.get('id') || req.nextUrl.searchParams.get('altegioId') || '').toString().trim();
  const scan = Math.max(100, Math.min(20000, parseInt((req.nextUrl.searchParams.get('scan') || '5000').toString(), 10) || 5000));
  const id = asNum(idRaw);

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Provide numeric id' }, { status: 400 });
  }

  // Беремо KV-лог записів. Це може бути важко, тому дозволяємо scan.
  const raw = await kvRead.lrange('altegio:records:log', 0, scan - 1);

  const hits: Array<{
    idx: number;
    kind: 'clientId' | 'recordId' | 'unknown';
    altegioClientId: number | null;
    altegioRecordId: number | null;
    receivedAt: string | null;
  }> = [];

  for (let i = 0; i < raw.length; i++) {
    const parsed = unwrapKV(raw[i]);
    if (!parsed || typeof parsed !== 'object') continue;

    // можливі місця: root.clientId, root.data.client.id, root.data.id, root.id
    const recordId =
      asNum((parsed as any).recordId) ??
      asNum((parsed as any).id) ??
      asNum((parsed as any).data?.id) ??
      null;
    const clientId =
      asNum((parsed as any).clientId) ??
      asNum((parsed as any).data?.client?.id) ??
      asNum((parsed as any).data?.client_id) ??
      null;
    const receivedAt =
      (parsed as any).receivedAt ? String((parsed as any).receivedAt) :
      (parsed as any).data?.receivedAt ? String((parsed as any).data.receivedAt) :
      null;

    const matchClient = clientId === id;
    const matchRecord = recordId === id;
    if (!matchClient && !matchRecord) continue;

    hits.push({
      idx: i,
      kind: matchClient ? 'clientId' : 'recordId',
      altegioClientId: clientId,
      altegioRecordId: recordId,
      receivedAt,
    });

    if (hits.length >= 50) break;
  }

  return NextResponse.json({
    ok: true,
    query: { id, scan },
    hitsCount: hits.length,
    hits: hits.slice(0, 50),
    note:
      hits.length === 0
        ? 'Не знайшов в altegio:records:log (можливо це не record/client id, або треба збільшити scan)'
        : 'Якщо kind=recordId — шукай altegioClientId в цьому ж рядку і використовуй його в set-responsible-master.',
  });
}

