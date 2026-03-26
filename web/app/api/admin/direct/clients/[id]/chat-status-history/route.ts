// web/app/api/admin/direct/clients/[id]/chat-status-history/route.ts
// Історія змін статусів переписки для клієнта.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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


    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 50) || 50));


    // Спочатку перевіряємо без include, щоб виключити проблеми зі зв'язаними даними
    const logsWithoutInclude = await prisma.directClientChatStatusLog.findMany({
      where: { clientId },
      orderBy: [{ changedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        clientId: true,
        fromStatusId: true,
        toStatusId: true,
        changedAt: true,
        changedBy: true,
        note: true,
      },
    });

    console.log(`[direct/chat-status-history] 🔍 Found ${logsWithoutInclude.length} logs without include for client ${clientId}`, {
      clientId,
      total: logsWithoutInclude.length,
      logIds: logsWithoutInclude.map(l => l.id),
    });

    // ВАЖЛИВО: Prisma include з nullable foreign keys може повертати порожній результат
    // якщо якісь статуси були видалені. Тому завжди використовуємо fallback підхід
    // (завантажуємо статуси окремо), щоб гарантувати, що всі логи повертаються.
    // Це також працює швидше, бо не потрібно робити складний JOIN.
    
    // Завантажуємо статуси окремо
    const statusIds = new Set<string>();
    logsWithoutInclude.forEach(log => {
      if (log.fromStatusId) statusIds.add(log.fromStatusId);
      if (log.toStatusId) statusIds.add(log.toStatusId);
    });
    
    const statuses = statusIds.size > 0 
      ? await prisma.directChatStatus.findMany({
          where: { id: { in: Array.from(statusIds) } },
          select: { id: true, name: true, color: true },
        }).catch((statusErr) => {
          console.error('[direct/chat-status-history] ⚠️ Error loading statuses separately:', statusErr);
          return [];
        })
      : [];
    
    const statusMap = new Map(statuses.map(s => [s.id, s]));
    
    const logs = logsWithoutInclude.map(log => ({
      id: log.id,
      clientId: log.clientId,
      fromStatusId: log.fromStatusId,
      toStatusId: log.toStatusId,
      changedAt: log.changedAt.toISOString(),
      changedBy: log.changedBy,
      note: log.note,
      fromStatus: log.fromStatusId ? (statusMap.get(log.fromStatusId) || null) : null,
      toStatus: log.toStatusId ? (statusMap.get(log.toStatusId) || null) : null,
    }));
    
    console.log(`[direct/chat-status-history] ✅ Loaded ${logs.length} logs with manually fetched statuses (${statuses.length} statuses found from ${statusIds.size} unique status IDs)`);


    console.log(`[direct/chat-status-history] ✅ Retrieved ${logs.length} logs for client ${clientId}`, {
      clientId,
      total: logs.length,
      logIds: logs.map(l => l.id),
      firstLog: logs[0] ? { id: logs[0].id, fromStatusId: logs[0].fromStatusId, toStatusId: logs[0].toStatusId, changedAt: logs[0].changedAt } : null,
      logsWithoutIncludeCount: logsWithoutInclude.length,
    });

    return NextResponse.json({ ok: true, clientId, total: logs.length, logs });
  } catch (err) {
    
    console.error('[direct/chat-status-history] ❌ GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

