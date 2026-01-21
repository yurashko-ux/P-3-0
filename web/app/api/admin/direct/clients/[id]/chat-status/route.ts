// web/app/api/admin/direct/clients/[id]/chat-status/route.ts
// Призначення/підтвердження статусу переписки для клієнта.
// ВАЖЛИВО:
// - `chatStatusCheckedAt` оновлюємо ЗАВЖДИ (це “підтвердження”), навіть якщо статус не змінився.
// - Лог у `direct_client_chat_status_logs` пишемо ТІЛЬКИ коли статус реально змінився.
// - `updatedAt` клієнта не чіпаємо (щоб таблиця не “пливла”).

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

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = (ctx?.params?.id || '').toString();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: 'client id is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const statusIdRaw = body?.statusId;
    const nextStatusId =
      statusIdRaw === null || statusIdRaw === undefined || String(statusIdRaw).trim() === ''
        ? null
        : String(statusIdRaw).trim();

    const existing = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        chatStatusId: true,
        chatStatusSetAt: true,
        chatStatusCheckedAt: true,
        chatStatusAnchorMessageId: true,
        chatStatusAnchorMessageReceivedAt: true,
        chatStatusAnchorSetAt: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const prevStatusId = existing.chatStatusId ?? null;
    const changed = prevStatusId !== nextStatusId;
    const now = new Date();

    // Якщо статус вказали — перевіримо, що він існує (і активний), щоб не зберегти сміття.
    if (nextStatusId) {
      const status = await prisma.directChatStatus.findUnique({
        where: { id: nextStatusId },
        select: { id: true, isActive: true, name: true },
      });
      if (!status) {
        return NextResponse.json({ ok: false, error: 'Chat status not found' }, { status: 404 });
      }
      if (!status.isActive) {
        return NextResponse.json({ ok: false, error: 'Chat status is inactive' }, { status: 400 });
      }
    }

    // Якщо статус реально змінився — “якоримо” його на останньому повідомленні в чаті на цей момент.
    // Якщо змін немає (це “Підтвердити”) — anchor НЕ рухаємо.
    const lastMessage = changed
      ? await prisma.directMessage.findFirst({
          where: { clientId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, receivedAt: true },
        })
      : null;

    const updated = await prisma.directClient.update({
      where: { id: clientId },
      // НЕ чіпаємо updatedAt тут свідомо
      data: {
        chatStatusId: nextStatusId,
        chatStatusCheckedAt: now,
        chatStatusSetAt: changed ? (nextStatusId ? now : null) : existing.chatStatusSetAt,
        chatStatusAnchorMessageId: changed ? (lastMessage?.id ?? null) : existing.chatStatusAnchorMessageId,
        chatStatusAnchorMessageReceivedAt: changed
          ? (lastMessage?.receivedAt ?? null)
          : existing.chatStatusAnchorMessageReceivedAt,
        chatStatusAnchorSetAt: changed ? now : existing.chatStatusAnchorSetAt,
      },
      select: {
        id: true,
        chatStatusId: true,
        chatStatusSetAt: true,
        chatStatusCheckedAt: true,
        chatStatusAnchorMessageId: true,
        chatStatusAnchorMessageReceivedAt: true,
        chatStatusAnchorSetAt: true,
      },
    });

    if (changed) {
      // #region agent log
      try {
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'web/app/api/admin/direct/clients/[id]/chat-status/route.ts:changed',message:'Chat status changed; anchor stored',data:{clientId:String(clientId||'').slice(0,12),from:String(prevStatusId||''),to:String(nextStatusId||''),anchorIdPresent:Boolean(updated.chatStatusAnchorMessageId),anchorReceivedAtPresent:Boolean((updated as any).chatStatusAnchorMessageReceivedAt)},timestamp:Date.now(),sessionId:'debug-session',runId:'chat-anchor-1',hypothesisId:'H_anchor_mismatch'})}).catch(()=>{});
      } catch {}
      // #endregion agent log
      await prisma.directClientChatStatusLog.create({
        data: {
          clientId,
          fromStatusId: prevStatusId,
          toStatusId: nextStatusId,
          changedAt: now,
          changedBy: 'admin',
          note: null,
        },
      });
      console.log('[direct/chat-status] ✅ Status changed:', { clientId, from: prevStatusId, to: nextStatusId });
    } else {
      console.log('[direct/chat-status] ✅ Status confirmed (no change):', { clientId, statusId: nextStatusId });
    }

    return NextResponse.json({ ok: true, changed, client: updated });
  } catch (err) {
    console.error('[direct/chat-status] ❌ POST error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

