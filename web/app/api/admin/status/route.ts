// web/app/api/admin/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';
import type { Campaign } from '@/lib/types';

const PAIR_INDEX = (p: number, s: number) => `kc:index:cards:${p}:${s}`;

function ok(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function err(message: string, status = 400, extra?: any) {
  return ok({ ok: false, error: message, ...(extra ?? {}) }, status);
}

/**
 * Auth strategy:
 * 1) Authorization: Bearer <ADMIN_PASS>
 * 2) OR query ?pass=<ADMIN_PASS>  (зручно тестувати з браузера)
 */
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';

  const expected = process.env.ADMIN_PASS || '';
  const ok =
    (expected && bearer && bearer === expected) ||
    (expected && passParam && passParam === expected);

  if (!ok) {
    // Спробуємо стандартну перевірку (на випадок кастомної логіки в assertAdmin)
    try {
      await assertAdmin(req);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export async function GET(req: NextRequest) {
  const authed = await ensureAdmin(req);
  if (!authed) {
    // віддаємо JSON (а не HTML), щоб curl/python могли це прочитати
    return err('Unauthorized: provide Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>', 401, {
      have_ADMIN_PASS_env: Boolean(process.env.ADMIN_PASS),
      auth_header_present: Boolean(req.headers.get('authorization')),
    });
  }

  // 1) Кампанії
  const ids: string[] = (await kvZRange('campaigns:index', 0, -1)) || [];
  const campaignsCount = ids.length;

  let firstCampaign: Partial<Campaign> | null = null;
  let pairKey: string | null = null;
  let pairIndexSample: string[] = [];
  if (ids[0]) {
    const raw = await kvGet<any>(`campaigns:${ids[0]}`);
    if (raw) {
      const c: Campaign = typeof raw === 'string' ? JSON.parse(raw) : raw;
      firstCampaign = {
        id: c.id,
        name: c.name,
        active: (c as any).active,
        base_pipeline_id: (c as any).base_pipeline_id,
        base_status_id: (c as any).base_status_id,
        rules: (c as any).rules,
      } as any;
      if ((c as any).base_pipeline_id && (c as any).base_status_id) {
        pairKey = PAIR_INDEX((c as any).base_pipeline_id, (c as any).base_status_id);
        try {
          // Спробуємо взяти останні ~20 елементів
          pairIndexSample = (await kvZRange(pairKey, -20, -1)) || [];
          if (!pairIndexSample.length) {
            const all = await kvZRange(pairKey, 0, -1);
            pairIndexSample = (all || []).slice(-20);
          }
        } catch {
          pairIndexSample = [];
        }
      }
    }
  }

  // 2) ENV/конфіг для KeyCRM
  const hasKeycrmToken = Boolean(process.env.KEYCRM_API_TOKEN);
  const keycrmBaseUrl = process.env.KEYCRM_BASE_URL || null;
  const hasAdminPass = Boolean(process.env.ADMIN_PASS);

  // 3) Ехо базової інформації про запит (щоб ловити редіректи/проксі)
  const url = new URL(req.url);
  const debug = {
    request: {
      method: 'GET',
      url: url.toString(),
      host: req.headers.get('host'),
      contentType: req.headers.get('content-type') || null,
      accept: req.headers.get('accept') || null,
      authHeaderPresent: Boolean(req.headers.get('authorization')),
      passParamPresent: url.searchParams.has('pass'),
    },
  };

  return ok({
    ok: true,
    env: {
      has_ADMIN_PASS: hasAdminPass,
      has_KEYCRM_API_TOKEN: hasKeycrmToken,
      KEYCRM_BASE_URL: keycrmBaseUrl,
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || null,
    },
    campaigns: {
      count: campaignsCount,
      first: firstCampaign,
    },
    indexes: {
      pair_key: pairKey,
      pair_index_sample: pairIndexSample,
      pair_index_sample_count: pairIndexSample.length,
    },
    ...debug,
  });
}
