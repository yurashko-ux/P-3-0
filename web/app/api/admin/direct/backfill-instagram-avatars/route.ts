// web/app/api/admin/direct/backfill-instagram-avatars/route.ts
// Backfill аватарок Instagram через Instagram Graph → KV (без ManyChat).

import { NextRequest, NextResponse } from 'next/server';
import { normalizeInstagram } from '@/lib/normalize';
import { kvRead } from '@/lib/kv';
import { getAllDirectClients } from '@/lib/direct-store';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { warmInstagramAvatarCache } from '@/lib/direct-instagram-avatar-warm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const onlyMissing = req.nextUrl.searchParams.get('onlyMissing') !== '0';
  const force = req.nextUrl.searchParams.get('force') === '1';
  const delayMs = Math.min(2000, Math.max(0, Number(req.nextUrl.searchParams.get('delayMs') || 150) || 150));
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 0);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 0;

  try {
    const clients = await getAllDirectClients();
    const candidates = clients
      .map((c) => ({
        id: c.id,
        username: normalizeInstagram(c.instagramUsername) || '',
        igsid: (c as { instagramScopedId?: string | null }).instagramScopedId || null,
      }))
      .filter((c) => c.username && hasNormalInstagramUsername(c.username));

    const stats = {
      clientsTotal: clients.length,
      usernamesUnique: new Set(candidates.map((c) => c.username)).size,
      processed: 0,
      skippedExisting: 0,
      saved: 0,
      failed: 0,
      withAvatar: 0,
    };
    const samples: Array<{ username: string; action: string; reason?: string }> = [];

    for (const row of candidates) {
      if (limit && stats.processed >= limit) break;
      stats.processed += 1;

      if (onlyMissing && !force) {
        try {
          const existing = await kvRead.getRaw(directAvatarKey(row.username));
          if (typeof existing === 'string' && /^https?:\/\//i.test(existing.trim())) {
            stats.skippedExisting += 1;
            if (samples.length < 20) samples.push({ username: row.username, action: 'skip_kv' });
            continue;
          }
        } catch {
          // continue
        }
      }

      const warm = await warmInstagramAvatarCache({
        username: row.username,
        clientId: row.id,
        igsid: row.igsid,
      });
      if (warm.ok && warm.avatarUrl) {
        stats.saved += 1;
        stats.withAvatar += 1;
        if (samples.length < 20) {
          samples.push({ username: row.username, action: warm.reason === 'kv_hit' ? 'kv_hit' : 'graph_saved' });
        }
      } else {
        stats.failed += 1;
        if (samples.length < 20) {
          samples.push({ username: row.username, action: 'fail', reason: warm.reason || 'not_found' });
        }
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    console.log('[backfill-instagram-avatars] Готово (Graph)', stats);
    return NextResponse.json({ ok: true, source: 'instagram_graph', stats, samples });
  } catch (err) {
    console.error('[backfill-instagram-avatars] Помилка:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
