// web/app/api/admin/debug/overview/route.ts
// Узагальнений огляд для тестової сторінки: стан середовища, кампаній та свіжих ManyChat-логів.

import { NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const TODAY_KEY = () => `logs:mc:${new Date().toISOString().slice(0, 10)}`;

type OverviewCampaign = {
  id: string;
  name?: string | null;
  active?: boolean;
  base_pipeline_id?: number | null;
  base_status_id?: number | null;
  created_at?: number | null;
};

type OverviewLog = {
  raw: string;
  ts?: number | null;
  matchesCount?: number | null;
  handle?: string | null;
  text?: string | null;
};

export async function GET() {
  const env = {
    keycrm_base: Boolean(process.env.KEYCRM_API_URL || process.env.KEYCRM_BASE_URL),
    keycrm_token: Boolean(
      process.env.KEYCRM_API_TOKEN ||
        process.env.KEYCRM_BEARER ||
        process.env.KEYCRM_TOKEN
    ),
    kv_url: Boolean(process.env.KV_REST_API_URL),
    kv_token: Boolean(
      process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN
    ),
    mc_token: Boolean(process.env.MC_TOKEN),
    admin_pass: Boolean(process.env.ADMIN_PASS),
  };

  let campaigns: OverviewCampaign[] = [];
  let kvError: string | null = null;

  try {
    const list = await kvRead.listCampaigns<Record<string, any>>();
    campaigns = list.map((item) => ({
      id: String(item?.id ?? item?.__index_id ?? ''),
      name: item?.name ?? null,
      active: item?.active !== false,
      base_pipeline_id:
        typeof item?.base_pipeline_id === 'number'
          ? item.base_pipeline_id
          : item?.base_pipeline_id
          ? Number(item.base_pipeline_id)
          : null,
      base_status_id:
        typeof item?.base_status_id === 'number'
          ? item.base_status_id
          : item?.base_status_id
          ? Number(item.base_status_id)
          : null,
      created_at:
        typeof item?.created_at === 'number'
          ? item.created_at
          : Number(item?.created_at) || null,
    }));
  } catch (error: any) {
    kvError = error?.message || String(error);
  }

  const logKey = TODAY_KEY();
  let logs: OverviewLog[] = [];
  let logsError: string | null = null;

  try {
    const rawItems = await kvRead.lrange(logKey, 0, 9);
    logs = rawItems.map((raw) => {
      try {
        const parsed = JSON.parse(raw);
        return {
          raw,
          ts: typeof parsed?.ts === 'number' ? parsed.ts : null,
          matchesCount:
            typeof parsed?.matchesCount === 'number'
              ? parsed.matchesCount
              : null,
          handle:
            parsed?.norm?.handle ??
            parsed?.normalized?.handle ??
            null,
          text:
            parsed?.norm?.text ??
            parsed?.normalized?.text ??
            null,
        } satisfies OverviewLog;
      } catch {
        return { raw } satisfies OverviewLog;
      }
    });
  } catch (error: any) {
    logsError = error?.message || String(error);
  }

  return NextResponse.json({
    ok: true,
    env,
    kv: {
      index: campaignKeys.INDEX_KEY,
      total: campaigns.length,
      error: kvError,
    },
    campaigns,
    logs: {
      key: logKey,
      entries: logs,
      error: logsError,
    },
  });
}
