// web/app/api/admin/direct/recover-instagram-from-messages/route.ts
// Відновлення Instagram для клієнтів з missing_instagram_* з rawData їхніх повідомлень

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDirectClient, saveDirectClient } from '@/lib/direct-store';
import { normalizeInstagram } from '@/lib/normalize';

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

function extractHandleFromRawData(rawData: string | null): string | null {
  if (!rawData || typeof rawData !== 'string') return null;
  const s = rawData.trim();
  if (!s) return null;

  try {
    // Спробуємо як JSON
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      const handle =
        parsed.handle ||
        parsed.username ||
        parsed.user_name ||
        parsed.instagram_username ||
        (parsed.subscriber as any)?.username ||
        (parsed.user as any)?.username ||
        (parsed.sender as any)?.username ||
        (parsed.message as any)?.username ||
        (parsed.message as any)?.handle ||
        null;
      if (handle && typeof handle === 'string') {
        const normalized = normalizeInstagram(handle);
        if (normalized && !normalized.startsWith('missing_instagram_') && !normalized.startsWith('no_instagram_')) {
          return normalized;
        }
      }
    }
  } catch {
    // Не JSON — пробуємо regex
  }

  // Regex fallback
  const patterns = [
    /"handle"\s*:\s*"([^"]+)"/,
    /"username"\s*:\s*"([^"]+)"/,
    /"user_name"\s*:\s*"([^"]+)"/,
    /"instagram_username"\s*:\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const normalized = normalizeInstagram(m[1]);
      if (normalized && !normalized.startsWith('missing_instagram_') && !normalized.startsWith('no_instagram_')) {
        return normalized;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const clientId = body.clientId as string | undefined; // Опціонально: тільки для конкретного клієнта

    // Знаходимо клієнтів з missing_instagram_* які мають повідомлення
    const clientsWithMissing = await prisma.directClient.findMany({
      where: {
        ...(clientId ? { id: clientId } : {}),
        OR: [
          { instagramUsername: { startsWith: 'missing_instagram_' } },
          { instagramUsername: { startsWith: 'no_instagram_' } },
        ],
      },
      include: {
        messages: {
          where: { rawData: { not: null } },
          orderBy: { receivedAt: 'asc' },
          take: 5,
        },
      },
    });

    const results: Array<{
      clientId: string;
      clientName: string;
      oldUsername: string;
      newUsername: string | null;
      recovered: boolean;
      message: string;
    }> = [];

    for (const client of clientsWithMissing) {
      let recoveredHandle: string | null = null;
      for (const msg of client.messages) {
        const handle = extractHandleFromRawData(msg.rawData);
        if (handle) {
          recoveredHandle = handle;
          break;
        }
      }

      const clientName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || '-';

      if (recoveredHandle) {
        try {
          const directClient = await getDirectClient(client.id);
          if (!directClient) {
            results.push({ clientId: client.id, clientName, oldUsername: client.instagramUsername, newUsername: recoveredHandle, recovered: false, message: 'Клієнт не знайдено' });
            continue;
          }
          const updated = { ...directClient, instagramUsername: recoveredHandle, updatedAt: new Date().toISOString() };
          await saveDirectClient(updated, 'recover-instagram-from-messages', { source: 'messages-rawData' }, { touchUpdatedAt: false });
          results.push({
            clientId: client.id,
            clientName,
            oldUsername: client.instagramUsername,
            newUsername: recoveredHandle,
            recovered: true,
            message: `Відновлено Instagram: ${recoveredHandle}`,
          });
          console.log(`[recover-instagram-from-messages] ✅ ${client.id} (${clientName}): ${client.instagramUsername} → ${recoveredHandle}`);
        } catch (err) {
          results.push({
            clientId: client.id,
            clientName,
            oldUsername: client.instagramUsername,
            newUsername: recoveredHandle,
            recovered: false,
            message: `Помилка збереження: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else {
        results.push({
          clientId: client.id,
          clientName,
          oldUsername: client.instagramUsername,
          newUsername: null,
          recovered: false,
          message: client.messages.length === 0
            ? 'Немає повідомлень з rawData'
            : 'Не вдалося витягнути handle з rawData повідомлень',
        });
      }
    }

    return NextResponse.json({
      ok: true,
      total: results.length,
      recovered: results.filter((r) => r.recovered).length,
      results,
    });
  } catch (err) {
    console.error('[recover-instagram-from-messages] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
