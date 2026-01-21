// web/app/api/admin/direct/debug-direct-client-links/route.ts
// DEBUG (safe): показує, як зв'язані DirectClient записи по altegioClientId / instagramUsername.
// Не повертаємо PII (телефон/повне ім'я), тільки наявність/довжини/ID.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeInstagram } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const altegioClientIdRaw = (req.nextUrl.searchParams.get('altegioClientId') || '').trim();
  const instagramRaw = (req.nextUrl.searchParams.get('instagramUsername') || '').trim();
  const altegioClientId = Number(altegioClientIdRaw);
  const normalizedIg = instagramRaw ? (normalizeInstagram(instagramRaw) || instagramRaw.toLowerCase()) : '';

  if ((!altegioClientId || Number.isNaN(altegioClientId)) && !normalizedIg) {
    return NextResponse.json(
      { ok: false, error: 'Provide altegioClientId or instagramUsername' },
      { status: 400 },
    );
  }

  const whereOr: any[] = [];
  if (altegioClientId && Number.isFinite(altegioClientId)) whereOr.push({ altegioClientId });
  if (normalizedIg) whereOr.push({ instagramUsername: normalizedIg });

  const clients = await prisma.directClient.findMany({
    where: { OR: whereOr },
    select: {
      id: true,
      instagramUsername: true,
      altegioClientId: true,
      firstName: true,
      lastName: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Порахуємо пов'язані сутності, щоб зрозуміти, який запис “живіший”
  const ids = clients.map((c) => c.id);
  const [msgCounts, stateCounts, chatCounts] = ids.length
    ? await Promise.all([
        prisma.directMessage.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _count: { _all: true } }),
        prisma.directClientStateLog.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _count: { _all: true } }),
        prisma.directClientChatStatusLog.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _count: { _all: true } }),
      ])
    : [[], [], []];

  const toMap = (rows: Array<any>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.clientId), Number(r._count?._all || 0));
    return m;
  };
  const msgMap = toMap(msgCounts as any);
  const stateMap = toMap(stateCounts as any);
  const chatMap = toMap(chatCounts as any);

  const payload = clients.map((c) => ({
    id: c.id,
    instagramUsername: c.instagramUsername,
    altegioClientId: c.altegioClientId,
    firstNamePresent: Boolean(c.firstName && c.firstName.trim()),
    lastNamePresent: Boolean(c.lastName && c.lastName.trim()),
    phonePresent: Boolean(c.phone && c.phone.trim()),
    phoneLength: c.phone ? c.phone.length : 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messagesCount: msgMap.get(c.id) ?? 0,
    stateLogsCount: stateMap.get(c.id) ?? 0,
    chatStatusLogsCount: chatMap.get(c.id) ?? 0,
  }));

  // #region agent log
  try {
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'merge-1',hypothesisId:'H_merge_direction',location:'web/app/api/admin/direct/debug-direct-client-links/route.ts:GET',message:'debug links queried',data:{altegioClientId:Number.isFinite(altegioClientId)?altegioClientId:null,hasIg:Boolean(normalizedIg),count:payload.length,ids:payload.map(x=>String(x.id).slice(0,12))},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion agent log

  return NextResponse.json({
    ok: true,
    query: {
      altegioClientId: Number.isFinite(altegioClientId) ? altegioClientId : null,
      instagramUsername: normalizedIg || null,
    },
    clients: payload,
  });
}

