// web/app/api/admin/direct/clients/[id]/chat-status-history/route.ts
// Історія змін статусів переписки для клієнта.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = (ctx?.params?.id || '').toString();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: 'client id is required' }, { status: 400 });
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-status-history/route.ts:32',message:'Fetching chat status history',data:{clientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 50) || 50));

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-status-history/route.ts:40',message:'Querying database for chat status logs',data:{clientId,limit},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    const logs = await prisma.directClientChatStatusLog.findMany({
      where: { clientId },
      orderBy: [{ changedAt: 'desc' }],
      take: limit,
      include: {
        fromStatus: { select: { id: true, name: true, color: true } },
        toStatus: { select: { id: true, name: true, color: true } },
      },
    });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-status-history/route.ts:52',message:'Chat status logs retrieved',data:{clientId,totalLogs:logs.length,logIds:logs.map(l=>l.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    console.log(`[direct/chat-status-history] ✅ Retrieved ${logs.length} logs for client ${clientId}`, {
      clientId,
      total: logs.length,
      logIds: logs.map(l => l.id),
      firstLog: logs[0] ? { id: logs[0].id, fromStatusId: logs[0].fromStatusId, toStatusId: logs[0].toStatusId, changedAt: logs[0].changedAt } : null,
    });

    return NextResponse.json({ ok: true, clientId, total: logs.length, logs });
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-status-history/route.ts:57',message:'Error fetching chat status history',data:{error:err instanceof Error ? err.message : String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    console.error('[direct/chat-status-history] ❌ GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

