// web/app/api/admin/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';
import type { Campaign } from '@/lib/types';

const PAIR_INDEX = (p: number, s: number) => `kc:index:cards:${p}:${s}`;

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);

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
          active: c.active,
          base_pipeline_id: c.base_pipeline_id,
          base_status_id: c.base_status_id,
          rules: c.rules,
        } as any;
        if (c.base_pipeline_id && c.base_status_id) {
          pairKey = PAIR_INDEX(c.base_pipeline_id, c.base_status_id);
          // візьмемо останні ~20 id, якщо є
          try {
            pairIndexSample = (await kvZRange(pairKey, -20, -1)) || [];
            if (!pairIndexSample.length) {
              pairIndexSample = (await kvZRange(pairKey, 0, -1))?.slice(-20) || [];
            }
          } catch {
            pairIndexSample = [];
          }
        }
      }
    }

    // 2) ENV/конфіг для KeyCRM
    const hasKeycrmToken = Boolean(process.env.KEYCRM_API_TOKEN);
    const keycrmBaseUrl = process.env.KEYCRM_BASE_URL || 'not set';
    const hasAdminPass = Boolean(process.env.ADMIN_PASS);

    // 3) Відповідь
    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Unauthorized' },
      { status: 401 }
    );
  }
}
