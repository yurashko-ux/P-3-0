// web/app/api/debug/migrate-campaigns/route.ts
// Admin-only one-off migration to fix campaign index values like '{"value":"ID"}' -> 'ID'
// and backfill missing item fields (created_at, name, active). Rebuilds primary LIST index.
//
// Usage (authorized admin): POST /api/debug/migrate-campaigns
// Response: { ok, fixedCount, index: { before, after } }

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const cookie = req.cookies.get('admin_token')?.value || '';
  const token = header || cookie;
  return !!token && token === process.env.ADMIN_PASS;
}

function normalizeId(raw: string): string {
  if (!raw) return raw;
  if (raw[0] !== '{') return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.value === 'string') return obj.value;
  } catch {}
  return raw;
}

// Minimal REST helpers we need just for this migration
async function kvDel(key: string) {
  const base = process.env.KV_REST_API_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!base || !token) throw new Error('KV env missing for DEL');
  const res = await fetch(`${base.replace(/\/$/, '')}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`DEL ${key} failed: ${res.status}`);
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 1) Read both indices
    const primary = await kvRead.lrange(campaignKeys.INDEX_KEY, 0, -1).catch(() => []) as string[];
    const legacy  = await kvRead.lrange('campaigns:index', 0, -1).catch(() => []) as string[];

    const before = { primary, legacy };

    // 2) Normalize IDs and build unified unique list (keep original order: head=newest)
    const unified: string[] = [];
    const seen = new Set<string>();
    const pushUnique = (arr: string[]) => {
      for (const raw of arr) {
        const id = normalizeId(raw);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unified.push(id);
      }
    };
    pushUnique(primary);
    pushUnique(legacy);

    // 3) Backfill items
    let fixedCount = 0;
    for (const id of unified) {
      const key = campaignKeys.ITEM_KEY(id);
      const raw = await kvRead.getRaw(key);
      if (!raw) continue;
      let obj: any;
      try { obj = JSON.parse(raw); } catch { continue; }

      let changed = false;
      if (!obj.created_at) { obj.created_at = Number(id) || Date.now(); changed = true; }
      if (!obj.name) { obj.name = 'Untitled'; changed = true; }
      if (typeof obj.active === 'undefined') { obj.active = true; changed = true; }

      // Ensure counters exist
      if (typeof obj.v1_count !== 'number') { obj.v1_count = 0; changed = true; }
      if (typeof obj.v2_count !== 'number') { obj.v2_count = 0; changed = true; }
      if (typeof obj.exp_count !== 'number') { obj.exp_count = 0; changed = true; }
      if (typeof obj.pair_lookup_success_count !== 'number') { obj.pair_lookup_success_count = 0; changed = true; }
      if (typeof obj.pair_lookup_fail_count !== 'number') { obj.pair_lookup_fail_count = 0; changed = true; }
      if (typeof obj.pair_move_success_count !== 'number') { obj.pair_move_success_count = 0; changed = true; }
      if (typeof obj.pair_move_fail_count !== 'number') { obj.pair_move_fail_count = 0; changed = true; }

      if (changed) {
        await kvWrite.setRaw(key, JSON.stringify(obj));
        fixedCount++;
      }
    }

    // 4) Rebuild primary LIST index with normalized IDs
    //    - delete both indices, then LPUSH normalized ids in reverse order
    //      so that unified[0] stays at the HEAD after rebuild.
    try { await kvDel(campaignKeys.INDEX_KEY); } catch {}
    try { await kvDel('campaigns:index'); } catch {}

    for (let i = unified.length - 1; i >= 0; i--) {
      await kvWrite.lpush(campaignKeys.INDEX_KEY, unified[i]);
    }

    const afterPrimary = await kvRead.lrange(campaignKeys.INDEX_KEY, 0, -1).catch(() => []) as string[];

    return NextResponse.json({
      ok: true,
      fixedCount,
      index: {
        before,
        after: { primary: afterPrimary },
      },
      note: 'Index normalized to plain string IDs; legacy index removed. Items backfilled.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'migration failed' }, { status: 500 });
  }
}
