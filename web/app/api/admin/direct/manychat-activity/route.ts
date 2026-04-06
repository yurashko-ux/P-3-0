import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function extractReceivedAt(raw: unknown): string | null {
  try {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      parsed = JSON.parse(raw);
    } else if (raw && typeof raw === 'object') {
      const rawObj = raw as Record<string, unknown>;
      if ('value' in rawObj && typeof rawObj.value === 'string') {
        parsed = JSON.parse(rawObj.value);
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const receivedAt = typeof rec.receivedAt === 'string' ? rec.receivedAt.trim() : '';
    return receivedAt || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const items = await kvRead.lrange('manychat:webhook:log', 0, 9);
    let latestReceivedAt: string | null = null;

    for (const item of items) {
      const receivedAt = extractReceivedAt(item);
      if (!receivedAt) continue;
      if (!latestReceivedAt || receivedAt > latestReceivedAt) {
        latestReceivedAt = receivedAt;
      }
    }

    return NextResponse.json({
      ok: true,
      latestReceivedAt,
      hasActivity: Boolean(latestReceivedAt),
    });
  } catch (error) {
    console.error('[direct/manychat-activity] Failed to read ManyChat activity:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
