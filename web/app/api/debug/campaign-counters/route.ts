// web/app/api/debug/campaign-counters/route.ts
// Діагностичний ендпоінт для перевірки лічильників кампаній

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';
import { normalizeCampaignShape } from '@/lib/campaign-shape';
import { kv } from '@vercel/kv';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const campaignId = req.nextUrl.searchParams.get('campaign_id');
    
    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaign_id parameter is required' },
        { status: 400 }
      );
    }

    const itemKey = campaignKeys.ITEM_KEY(campaignId);
    
    // Читаємо через kvRead.getRaw
    const rawFromKvRead = await kvRead.getRaw(itemKey);
    const normalizedFromKvRead = rawFromKvRead ? normalizeCampaignShape(rawFromKvRead) : null;
    
    // Читаємо через @vercel/kv
    let rawFromVercelKv: any = null;
    try {
      rawFromVercelKv = await kv.get(itemKey);
    } catch (err) {
      // Ігноруємо помилки
    }

    // Читаємо через listCampaigns
    const allCampaigns = await kvRead.listCampaigns();
    const fromListCampaigns = allCampaigns.find((c) => c.id === campaignId || (c as any).__index_id === campaignId);

    return NextResponse.json({
      campaignId,
      itemKey,
      sources: {
        kvRead: {
          hasRaw: !!rawFromKvRead,
          rawLength: rawFromKvRead?.length,
          normalized: normalizedFromKvRead ? {
            id: normalizedFromKvRead.id,
            name: normalizedFromKvRead.name,
            v1_count: normalizedFromKvRead.v1_count,
            v2_count: normalizedFromKvRead.v2_count,
            exp_count: normalizedFromKvRead.exp_count,
            counters: normalizedFromKvRead.counters,
            movedTotal: normalizedFromKvRead.movedTotal,
            movedV1: normalizedFromKvRead.movedV1,
            movedV2: normalizedFromKvRead.movedV2,
            movedExp: normalizedFromKvRead.movedExp,
            baseCardsCount: normalizedFromKvRead.baseCardsCount,
            baseCardsTotalPassed: normalizedFromKvRead.baseCardsTotalPassed,
          } : null,
        },
        vercelKv: {
          hasData: !!rawFromVercelKv,
          data: rawFromVercelKv ? {
            id: rawFromVercelKv.id,
            name: rawFromVercelKv.name,
            v1_count: rawFromVercelKv.v1_count,
            v2_count: rawFromVercelKv.v2_count,
            exp_count: rawFromVercelKv.exp_count,
            counters: rawFromVercelKv.counters,
            movedTotal: rawFromVercelKv.movedTotal,
            movedV1: rawFromVercelKv.movedV1,
            movedV2: rawFromVercelKv.movedV2,
            movedExp: rawFromVercelKv.movedExp,
            baseCardsCount: rawFromVercelKv.baseCardsCount,
            baseCardsTotalPassed: rawFromVercelKv.baseCardsTotalPassed,
          } : null,
        },
        listCampaigns: fromListCampaigns ? {
          id: fromListCampaigns.id,
          name: fromListCampaigns.name,
          v1_count: (fromListCampaigns as any).v1_count,
          v2_count: (fromListCampaigns as any).v2_count,
          exp_count: (fromListCampaigns as any).exp_count,
          counters: fromListCampaigns.counters,
          movedTotal: fromListCampaigns.movedTotal,
          movedV1: fromListCampaigns.movedV1,
          movedV2: fromListCampaigns.movedV2,
          movedExp: fromListCampaigns.movedExp,
          baseCardsCount: fromListCampaigns.baseCardsCount,
          baseCardsTotalPassed: fromListCampaigns.baseCardsTotalPassed,
        } : null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'internal_error',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}

