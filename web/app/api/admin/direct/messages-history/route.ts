// web/app/api/admin/direct/messages-history/route.ts
// API endpoint для отримання історії повідомлень ManyChat для клієнта
// Джерело: DirectMessage (PostgreSQL) — постійне зберігання, повідомлення не зникають

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeInstagram } from '@/lib/normalize';
import { kvRead } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const instagramUsername = req.nextUrl.searchParams.get('instagramUsername');

    if (!clientId && !instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'clientId or instagramUsername is required' },
        { status: 400 }
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

    if (resolvedClientId) {
      const dbMessages = await prisma.directMessage.findMany({
        where: { clientId: resolvedClientId },
        orderBy: { receivedAt: 'desc' },
        include: {
          client: {
            select: {
              instagramUsername: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

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
          };
        });
        return NextResponse.json({
          ok: true,
          total: messages.length,
          messages,
          source: 'database',
        });
      }
    }

    // Fallback: KV лог (для клієнтів без записів у DirectMessage)
    if (instagramUsername) {
      const kvMessages = await getMessagesFromKvLog(instagramUsername);
      return NextResponse.json({
        ok: true,
        total: kvMessages.length,
        messages: kvMessages,
        source: 'kv_log',
      });
    }

    return NextResponse.json({
      ok: true,
      total: 0,
      messages: [],
    });
  } catch (error) {
    console.error('[direct/messages-history] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
