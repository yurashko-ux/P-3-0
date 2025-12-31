// web/app/api/admin/direct/telegram-messages/route.ts
// API endpoint для отримання повідомлень з Telegram бота

import { NextRequest, NextResponse } from 'next/server';
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
 * GET - отримати повідомлення з Telegram бота
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;

    // Отримуємо повідомлення з KV
    const rawItems = await kvRead.lrange('telegram:direct-reminders:log', 0, limit - 1);
    const messages = rawItems
      .map((raw) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      messages,
      count: messages.length,
    });
  } catch (error) {
    console.error('[telegram-messages] Error fetching messages:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      messages: [],
    }, { status: 500 });
  }
}

