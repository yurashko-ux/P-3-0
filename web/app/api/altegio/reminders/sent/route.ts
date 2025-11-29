// web/app/api/altegio/reminders/sent/route.ts
// Endpoint для перегляду відправлених нагадувань

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200)
      : 50;

    const logKey = 'altegio:reminder:sent:log';
    const logRaw = await kvRead.getRaw(logKey);
    let logs: any[] = [];

    if (logRaw) {
      try {
        let parsed: any;
        if (typeof logRaw === 'string') {
          try {
            parsed = JSON.parse(logRaw);
          } catch {
            parsed = logRaw;
          }
        } else {
          parsed = logRaw;
        }

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = parsed.value ?? parsed.result ?? parsed.data;
          if (candidate !== undefined) {
            if (typeof candidate === 'string') {
              try {
                parsed = JSON.parse(candidate);
              } catch {
                parsed = candidate;
              }
            } else {
              parsed = candidate;
            }
          }
        }

        if (Array.isArray(parsed)) {
          logs = parsed;
        }
      } catch (err) {
        console.warn('[reminders/sent] Failed to parse log:', err);
        logs = [];
      }
    }

    // Обмежуємо кількість
    const limitedLogs = logs.slice(0, limit);

    // Форматуємо для UI
    const formatted = limitedLogs.map((log) => ({
      timestamp: log.timestamp,
      timestampFormatted: new Date(log.timestamp).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      jobId: log.jobId,
      visitId: log.visitId,
      instagram: log.instagram,
      clientName: log.clientName,
      message: log.message,
      visitDateTime: log.visitDateTime,
      visitDateTimeFormatted: new Date(log.visitDateTime).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      ruleId: log.ruleId,
      success: log.result?.success ?? true,
      messageId: log.result?.messageId,
      error: log.result?.error,
    }));

    return NextResponse.json({
      ok: true,
      count: formatted.length,
      total: logs.length,
      logs: formatted,
    });
  } catch (error) {
    console.error('[reminders/sent] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

