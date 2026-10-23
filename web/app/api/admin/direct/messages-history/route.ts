// web/app/api/admin/direct/messages-history/route.ts
// API endpoint для отримання історії повідомлень ManyChat для клієнта
// Джерело: DirectMessage (PostgreSQL) — постійне зберігання, повідомлення не зникають

import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { normalizeInstagram } from '@/lib/normalize';
import { kvRead } from '@/lib/kv';
import { type DirectChatChannel, sourcesWhereClause, isSourceForChannel } from '@/lib/direct-channel-chat';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { instagramReplyAvailability } from '@/lib/instagram-direct-send';
import { syncInstagramSalonReactions } from '@/lib/instagram-salon-reactions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function historyJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    },
  });
}

async function replyPayload(
  clientId: string | null,
  channel: DirectChatChannel | null,
): Promise<{ instagramReply?: Awaited<ReturnType<typeof instagramReplyAvailability>> }> {
  if (!clientId || channel === 'telegram') return {};
  try {
    return { instagramReply: await instagramReplyAvailability(clientId) };
  } catch (error) {
    console.warn(
      '[direct/messages-history] Не вдалося перевірити відповідь Instagram',
      error instanceof Error ? error.message : String(error),
    );
    return {
      instagramReply: { canSend: false, hasId: false, windowOpen: false, lastIncomingAt: null },
    };
  }
}

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

/**
 * Витягує дані з rawBody вебхука (для fallback)
 */
function extractDataFromRawBody(rawBody: string): {
  username: string | null;
  fullName: string | null;
  text: string | null;
} {
  try {
    const parsed = JSON.parse(rawBody);
    const username =
      parsed.username ||
      parsed.handle ||
      parsed.user_name ||
      parsed.instagram_username ||
      null;
    const fullName =
      parsed.full_name ||
      parsed.fullName ||
      parsed.fullname ||
      parsed.name ||
      (parsed.first_name && parsed.last_name ? `${parsed.first_name} ${parsed.last_name}` : null) ||
      null;
    const text =
      parsed.text ||
      parsed.message ||
      parsed.last_input_text ||
      parsed.input ||
      null;
    return { username, fullName, text };
  } catch {
    try {
      const usernameMatch = rawBody.match(/"username"\s*:\s*"([^"]+)"/);
      const fullNameMatch = rawBody.match(/"full_name"\s*:\s*"([^"]+)"/);
      const textMatch = rawBody.match(/"text"\s*:\s*"([^"]+)"/);
      return {
        username: usernameMatch ? usernameMatch[1] : null,
        fullName: fullNameMatch ? fullNameMatch[1] : null,
        text: textMatch ? textMatch[1] : null,
      };
    } catch {
      return { username: null, fullName: null, text: null };
    }
  }
}

/**
 * Fallback: отримати повідомлення з KV manychat:webhook:log (тимчасовий лог, останні 1000)
 */
async function getMessagesFromKvLog(instagramUsername: string) {
  const rawItems = await kvRead.lrange('manychat:webhook:log', 0, 999);
  const normalizedClientUsername = normalizeInstagram(instagramUsername);
  if (!normalizedClientUsername) return [];

  const webhooks = rawItems
    .map((raw) => {
      try {
        let parsed: unknown = raw;
        if (typeof raw === 'string') {
          parsed = JSON.parse(raw);
        } else if (raw && typeof raw === 'object') {
          const rawObj = raw as Record<string, unknown>;
          if ('value' in rawObj && typeof rawObj.value === 'string') {
            parsed = JSON.parse(rawObj.value);
          } else {
            parsed = raw;
          }
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const parsedObj = parsed as Record<string, unknown>;
          if ('receivedAt' in parsedObj) return parsedObj;
        }
        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  return webhooks
    .map((webhook) => {
      const receivedAt = webhook.receivedAt as string | undefined;
      const rawBody = webhook.rawBody as string | undefined;
      if (!receivedAt || !rawBody) return null;
      const { username, fullName, text } = extractDataFromRawBody(rawBody);
      if (!username) return null;
      const normalizedUsername = normalizeInstagram(username);
      if (normalizedUsername !== normalizedClientUsername) return null;
      return {
        receivedAt,
        text: text || '-',
        fullName: fullName || 'Невідомий клієнт',
        username: normalizedUsername,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
}

/**
 * GET - отримати історію повідомлень ManyChat для клієнта
 * Пріоритет: DirectMessage (постійна БД) → fallback на KV лог
 */
export async function GET(req: NextRequest) {
  noStore();
  if (!isAuthorized(req)) {
    return historyJson({ error: 'Unauthorized' }, 401);
  }

  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const instagramUsername = req.nextUrl.searchParams.get('instagramUsername');
    const channelParam = req.nextUrl.searchParams.get('channel');
    const channel: DirectChatChannel | null =
      channelParam === 'telegram' ? 'telegram' : channelParam === 'instagram' ? 'instagram' : null;

    if (!clientId && !instagramUsername) {
      return historyJson(
        { ok: false, error: 'clientId or instagramUsername is required' },
        400
      );
    }

    let resolvedClientId: string | null = clientId || null;

    if (!resolvedClientId && instagramUsername) {
      const normalized = normalizeInstagram(instagramUsername);
      if (normalized) {
        const client = await prisma.directClient.findFirst({
          where: { instagramUsername: normalized },
          select: { id: true },
        });
        resolvedClientId = client?.id ?? null;
      }
    }

    if (resolvedClientId && channel !== 'telegram') {
      try {
        await syncInstagramSalonReactions(resolvedClientId);
      } catch (error) {
        console.warn(
          '[direct/messages-history] Реакції салону не підтягнулись',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (resolvedClientId) {
      const orderBy = channel === 'telegram' ? { receivedAt: 'asc' as const } : { receivedAt: 'desc' as const };
      const includeClient = {
        client: {
          select: {
            instagramUsername: true,
            firstName: true,
            lastName: true,
          },
        },
        media: {
          select: { id: true, kind: true, mime: true, byteSize: true },
          orderBy: { createdAt: "asc" as const },
        },
      } as const;

      const readAt = new Date();
      let dbMessages = await prisma.directMessage.findMany({
        where: {
          clientId: resolvedClientId,
          receivedAt: { lte: readAt },
          ...(channel ? sourcesWhereClause(channel) : {}),
        },
        orderBy,
        include: includeClient,
      });

      // Якщо фільтр по source нічого не дав, а повідомлення є — показуємо їх (legacy source / регістр)
      if (dbMessages.length === 0 && channel === 'instagram') {
        const allForClient = await prisma.directMessage.findMany({
          where: { clientId: resolvedClientId, receivedAt: { lte: readAt } },
          orderBy,
          include: includeClient,
        });
        const nonTelegram = allForClient.filter((m) => isSourceForChannel(m.source, 'instagram'));
        dbMessages = nonTelegram.length > 0 ? nonTelegram : allForClient;
        if (allForClient.length > 0) {
          console.log('[direct/messages-history] Instagram filter empty → fallback', {
            clientId: resolvedClientId,
            total: allForClient.length,
            afterJsFilter: nonTelegram.length,
            sources: [...new Set(allForClient.map((m) => m.source))],
          });
        }
      }

      if (dbMessages.length > 0) {
        const messages = dbMessages.map((m) => {
          const fullName =
            [m.client.firstName, m.client.lastName].filter(Boolean).join(' ') ||
            'Невідомий клієнт';
          return {
            receivedAt: m.receivedAt.toISOString(),
            text: m.text || '-',
            fullName,
            username: m.client.instagramUsername || undefined,
            direction: m.direction,
            id: m.id,
            messageId: m.messageId || null,
            source: m.source,
            rawData: m.rawData || null,
            media: m.media.map((file) => ({
              id: file.id,
              kind: file.kind,
              mime: file.mime,
              byteSize: file.byteSize,
            })),
          };
        });
        const newest = messages[0];
        const clientRow = await prisma.directClient.findFirst({
          where: { id: resolvedClientId },
          select: { lastMessageAt: true },
        });
        const clientLastMessageAt = clientRow?.lastMessageAt?.toISOString() ?? null;
        // Після sync реакцій lastMessageAt на клієнті може бути новіший за «найсвіжіший» текст.
        const liftAt =
          clientLastMessageAt &&
          (!newest?.receivedAt || clientLastMessageAt > newest.receivedAt)
            ? clientLastMessageAt
            : newest?.receivedAt ?? clientLastMessageAt;
        const newestReaction = messages.find(
          (m) => String(m.source || '').toLowerCase() === 'instagram_reaction',
        );
        const liftDirection =
          liftAt && clientLastMessageAt && liftAt === clientLastMessageAt && newestReaction
            ? newestReaction.direction
            : newest?.direction ?? null;
        console.log('[direct/messages-history] відповідь з бази', {
          clientId: resolvedClientId,
          total: messages.length,
          newestAt: newest?.receivedAt ?? null,
          newestDirection: newest?.direction ?? null,
          newestText: (newest?.text || '').slice(0, 40),
          clientLastMessageAt,
          liftAt,
        });
        return historyJson({
          ok: true,
          total: messages.length,
          messages,
          source: 'database',
          clientLastMessageAt,
          liftAt,
          liftDirection,
          ...(await replyPayload(resolvedClientId, channel)),
        });
      }
    }

    // Fallback: KV лог (для клієнтів без записів у DirectMessage) — лише Instagram
    if (instagramUsername && channel !== 'telegram') {
      const kvMessages = await getMessagesFromKvLog(instagramUsername);
      return historyJson({
        ok: true,
        total: kvMessages.length,
        messages: kvMessages,
        source: 'kv_log',
        ...(await replyPayload(resolvedClientId, channel)),
      });
    }

    return historyJson({
      ok: true,
      total: 0,
      messages: [],
      ...(await replyPayload(resolvedClientId, channel)),
    });
  } catch (error) {
    console.error('[direct/messages-history] GET error:', error);
    return historyJson(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
