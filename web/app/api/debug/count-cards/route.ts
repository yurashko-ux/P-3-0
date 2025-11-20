// web/app/api/debug/count-cards/route.ts
// Діагностичний endpoint для перевірки підрахунку карток в базовій воронці кампанії

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';
import { countCardsInBasePipeline } from '@/lib/campaign-stats';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

function parseCampaignPayload(raw: string | null): any | null {
  if (!raw) return null;
  const stack: unknown[] = [raw];
  const visited = new Set<unknown>();

  while (stack.length) {
    const value = stack.pop();
    if (value == null) continue;
    if (visited.has(value)) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      try {
        stack.push(JSON.parse(trimmed));
      } catch {
        /* ignore */
      }
      continue;
    }

    if (Array.isArray(value)) {
      visited.add(value);
      for (const item of value) stack.push(item);
      continue;
    }

    if (typeof value !== 'object') continue;

    visited.add(value);
    const record = value as Record<string, unknown>;

    if ('id' in record || 'name' in record || 'base' in record || 'rules' in record || 'v1' in record || 'v2' in record) {
      return { ...(record as Record<string, any>) };
    }

    for (const key of ['value', 'result', 'data', 'payload', 'item', 'campaign']) {
      if (key in record) stack.push(record[key]);
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const campaignId = u.searchParams.get('campaign_id');
  
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  try {
    // Використовуємо listCampaigns, який вже правильно обробляє кампанії
    const allCampaigns = await kvRead.listCampaigns();
    let campaign = allCampaigns.find((c: any) => c.id === campaignId || c.__index_id === campaignId);
    
    if (!campaign) {
      const keysToTry = [
        campaignKeys.ITEM_KEY(campaignId),
        campaignKeys.CMP_ITEM_KEY(campaignId),
        campaignKeys.LEGACY_ITEM_KEY(campaignId),
      ];
      for (const key of keysToTry) {
        const raw = await kvRead.getRaw(key);
        const parsed = parseCampaignPayload(raw);
        if (parsed) {
          campaign = parsed;
          break;
        }
      }
    }

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found', campaignId }, { status: 404 });
    }

    
    // Перевіряємо всі можливі місця, де може бути pipeline_id/status_id
    // Увага: base.pipeline/base.status - це рядки, а не base.pipelineId/base.statusId
    const basePipelineId = campaign.base?.pipelineId || 
                           campaign.base?.pipeline_id ||
                           campaign.base?.pipeline ||  // ← додав base.pipeline (рядок)
                           campaign.base_pipeline_id ||
                           campaign.base_pipelineId;
    const baseStatusId = campaign.base?.statusId || 
                         campaign.base?.status_id ||
                         campaign.base?.status ||  // ← додав base.status (рядок)
                         campaign.base_status_id ||
                         campaign.baseStatusId;

    const count = await countCardsInBasePipeline(basePipelineId, baseStatusId);

    return NextResponse.json({
      ok: true,
      campaignId,
      campaignName: campaign.name,
      basePipelineId,
      baseStatusId,
      basePipelineIdType: typeof basePipelineId,
      baseStatusIdType: typeof baseStatusId,
      currentBaseCardsCount: campaign.baseCardsCount,
      countResult: count,
      campaignBase: campaign.base,
      campaignBaseKeys: campaign.base ? Object.keys(campaign.base) : null,
      fullCampaignKeys: Object.keys(campaign).slice(0, 30), // перші 30 ключів
      // Додаткова діагностика
      basePipelineValue: campaign.base?.pipeline,
      baseStatusValue: campaign.base?.status,
      basePipelineIdValue: campaign.base_pipeline_id,
      baseStatusIdValue: campaign.base_status_id,
      source: 'listCampaigns',
    });
  } catch (err: any) {
    return NextResponse.json({ 
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    }, { status: 500 });
  }
}

