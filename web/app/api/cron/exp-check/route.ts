// web/app/api/cron/exp-check/route.ts
// Cron job для щоденної перевірки та переміщення карток після експірації EXP

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';
import { checkCampaignExp } from '@/lib/exp-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function okCron(req: NextRequest) {
  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log('[exp-check] POST request received');
  
  if (!okCron(req)) {
    console.log('[exp-check] Request forbidden - not a valid cron request');
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  console.log('[exp-check] Request authorized, starting exp check');

  try {
    // Очищаємо кеш перед початком перевірки
    // (кеш буде автоматично заповнюватися під час обробки кампаній)
    const { clearCardsCache } = await import('@/lib/exp-check');
    clearCardsCache();
    
    // Отримуємо всі активні кампанії
    const campaigns = await kvRead.listCampaigns();
    console.log(`[exp-check] Found ${campaigns.length} total campaigns`);
    
    const results = [];
    let totalCardsChecked = 0;
    let totalCardsMoved = 0;
    const allErrors: string[] = [];
    
    // Перевіряємо кожну кампанію
    for (const campaign of campaigns) {
      // Пропускаємо видалені або неактивні кампанії
      if (campaign.deleted || campaign.active === false) {
        console.log(`[exp-check] Skipping campaign ${campaign.id}: deleted=${campaign.deleted}, active=${campaign.active}`);
        continue;
      }
      
      console.log(`[exp-check] Processing campaign ${campaign.id} (${campaign.name})`);
      
      try {
        const result = await checkCampaignExp(campaign);
        results.push(result);
        totalCardsChecked += result.cardsChecked;
        totalCardsMoved += result.cardsMoved;
        allErrors.push(...result.errors);
        console.log(`[exp-check] Campaign ${campaign.id} result:`, {
          cardsChecked: result.cardsChecked,
          cardsMoved: result.cardsMoved,
          errors: result.errors.length,
        });
      } catch (err) {
        console.error(`[exp-check] Error processing campaign ${campaign.id}:`, err);
        allErrors.push(`Campaign ${campaign.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      summary: {
        campaignsChecked: results.length,
        totalCardsChecked,
        totalCardsMoved,
        errorsCount: allErrors.length,
      },
      results,
      errors: allErrors.length > 0 ? allErrors : undefined,
    };
    
    console.log('[exp-check] Exp check completed:', response.summary);
    
    return NextResponse.json(response);
  } catch (e: any) {
    console.error('[exp-check] Fatal error:', e);
    return NextResponse.json(
      { 
        ok: false, 
        error: String(e),
        timestamp: new Date().toISOString(),
      }, 
      { status: 500 }
    );
  }
}

