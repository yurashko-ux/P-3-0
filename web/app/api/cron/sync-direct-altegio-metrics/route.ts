// web/app/api/cron/sync-direct-altegio-metrics/route.ts
// Щоденний cron: синхронізація phone/visits/spent з Altegio API для всіх Direct клієнтів з altegioClientId

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';
import { fetchAltegioLastVisitMap } from '@/lib/altegio/last-visit';
import { kvWrite } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function okCron(req: NextRequest) {
  // 0) Дозволяємо ручний запуск з адмін-кукою (для діагностики / форс-рану)
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

async function runSync(req: NextRequest) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:32',message:'Cron job started',data:{hasVercelCron:req.headers.get('x-vercel-cron')==='1',hasAdminToken:!!req.cookies.get('admin_token')?.value,hasSecret:!!req.nextUrl.searchParams.get('secret')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Детальне логування для діагностики автоматичного запуску (видно в Vercel logs)
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const hasAdminToken = !!req.cookies.get('admin_token')?.value;
  const hasSecret = !!req.nextUrl.searchParams.get('secret');
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  console.log('[cron/sync-direct-altegio-metrics] 🔍 Перевірка авторизації', {
    isVercelCron,
    hasAdminToken,
    hasSecret,
    userAgent: req.headers.get('user-agent'),
    xVercelCron: req.headers.get('x-vercel-cron'),
    authorization: req.headers.get('authorization'),
    method: req.method,
    url: req.url,
    allHeaders,
  });
  
  if (!okCron(req)) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:34',message:'Cron job forbidden',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.error('[cron/sync-direct-altegio-metrics] ❌ Доступ заборонено', {
      isVercelCron,
      hasAdminToken,
      hasSecret,
    });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  // KV heartbeat: зберігаємо факт запуску крону для діагностики (без PII).
  // Якщо KV недоступний — просто пропускаємо.
  try {
    const isVercelCron = req.headers.get('x-vercel-cron') === '1';
    const via = isVercelCron ? 'vercel' : 'secret';
    await kvWrite.setRaw(
      'direct:cron:sync-direct-altegio-metrics:lastRun',
      JSON.stringify({
        phase: 'start',
        via,
        startedAt: new Date().toISOString(),
        delayMs: req.nextUrl.searchParams.get('delayMs') || null,
        limit: req.nextUrl.searchParams.get('limit') || null,
      })
    );
  } catch {}

  const startedAt = Date.now();
  const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') || '200') || 200));
  const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') || '0') || 0));

  console.log('[cron/sync-direct-altegio-metrics] Старт', { delayMs, limit });

  const allClients = await getAllDirectClients();
  const targets = allClients.filter((c) => {
    const id = c.altegioClientId;
    const n = typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN;
    return !Number.isNaN(n) && n > 0;
  });
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:61',message:'Clients loaded',data:{totalClients:allClients.length,targetsCount:targets.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Підтягуємо дати останніх візитів з Altegio ОДНИМ проходом (clients/search) — щоб не робити 300+ запитів.
  // ВАЖЛИВО: беремо last_visit_date (має відповідати “успішному візиту” у Altegio).
  let lastVisitMap: Map<number, string> | null = null;
  try {
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || Number.isNaN(companyId)) {
      console.warn('[cron/sync-direct-altegio-metrics] ⚠️ ALTEGIO_COMPANY_ID не налаштовано — пропускаємо lastVisitAt');
      lastVisitMap = null;
    } else {
      const lvPages = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get('lvPages') || '60') || 60));
      const lvPageSize = Math.max(10, Math.min(200, Number(req.nextUrl.searchParams.get('lvPageSize') || '100') || 100));
      lastVisitMap = await fetchAltegioLastVisitMap({
        companyId,
        pageSize: lvPageSize,
        maxPages: lvPages,
        delayMs: 150,
      });
    }
  } catch (err) {
    console.warn('[cron/sync-direct-altegio-metrics] ⚠️ Не вдалося завантажити lastVisitMap (не критично):', err);
    lastVisitMap = null;
  }

  let processed = 0;
  let updated = 0;
  let skippedNoAltegioId = allClients.length - targets.length;
  let skippedNoChange = 0;
  let fetchedNotFound = 0;
  let errors = 0;
  let lastVisitUpdated = 0;
  let lastVisitFoundInMap = 0;
  let lastVisitSkippedAlreadySame = 0;

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; changedKeys?: string[] }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];
  const skippedDetails: Array<{ directClientId: string; altegioClientId: number; reason: string; currentSpent?: number | null; nextSpent?: number | null; currentVisits?: number | null; nextVisits?: number | null }> = [];

  for (let i = 0; i < targets.length; i++) {
    const client = targets[i];
    if (!client.altegioClientId) continue;
    if (limit && processed >= limit) break;
    processed++;

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:104',message:'Fetching metrics from Altegio',data:{directClientId:client.id,altegioClientId:client.altegioClientId,currentSpent:client.spent,currentVisits:client.visits},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      const res = await fetchAltegioClientMetrics({ altegioClientId: client.altegioClientId });
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:106',message:'Altegio metrics response',data:{directClientId:client.id,altegioClientId:client.altegioClientId,ok:res.ok,error:res.ok?null:(res as {ok:false,error:string}).error,metrics:res.ok?res.metrics:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      if (res.ok === false) {
        const errText = res.error || 'unknown_error';
        if (errText.toLowerCase().includes('not found')) {
          fetchedNotFound++;
          continue;
        }
        throw new Error(errText);
      }

      const nextPhone = res.metrics.phone ? res.metrics.phone : null;
      const nextVisits = res.metrics.visits ?? null;
      const nextSpent = res.metrics.spent ?? null;

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:117',message:'Comparing values',data:{directClientId:client.id,altegioClientId:client.altegioClientId,currentSpent:client.spent,nextSpent,spentEqual:client.spent===nextSpent,spentStrictEqual:client.spent!==nextSpent,currentVisits:client.visits,nextVisits,visitsEqual:client.visits===nextVisits,visitsStrictEqual:client.visits!==nextVisits},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // Нормалізуємо значення для порівняння (undefined -> null)
      const currentSpentNormalized = client.spent ?? null;
      const currentVisitsNormalized = client.visits ?? null;
      
      // Детальне логування для діагностики (видно в Vercel logs)
      console.log('[cron/sync-direct-altegio-metrics] Порівняння значень', {
        directClientId: client.id,
        altegioClientId: client.altegioClientId,
        firstName: client.firstName,
        lastName: client.lastName,
        instagramUsername: client.instagramUsername,
        currentSpent: client.spent,
        currentSpentNormalized,
        nextSpent,
        spentEqual: currentSpentNormalized === nextSpent,
        spentWillUpdate: nextSpent !== null && currentSpentNormalized !== nextSpent,
        spentTypes: { current: typeof client.spent, next: typeof nextSpent },
        currentVisits: client.visits,
        currentVisitsNormalized,
        nextVisits,
        visitsEqual: currentVisitsNormalized === nextVisits,
        visitsWillUpdate: nextVisits !== null && currentVisitsNormalized !== nextVisits,
        visitsTypes: { current: typeof client.visits, next: typeof nextVisits },
      });

      const updates: any = {};
      const changedKeys: string[] = [];

      if (nextPhone && (!client.phone || client.phone.trim() !== nextPhone)) {
        updates.phone = nextPhone;
        changedKeys.push('phone');
      }
      // Використовуємо нормалізоване порівняння для visits (враховуємо null vs undefined)
      if (nextVisits !== null && currentVisitsNormalized !== nextVisits) {
        updates.visits = nextVisits;
        changedKeys.push('visits');
      }
      // Використовуємо нормалізоване порівняння для spent (враховуємо null vs undefined)
      if (nextSpent !== null && currentSpentNormalized !== nextSpent) {
        updates.spent = nextSpent;
        changedKeys.push('spent');
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:133',message:'Update decision',data:{directClientId:client.id,altegioClientId:client.altegioClientId,changedKeys,hasUpdates:changedKeys.length>0,updates},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      // lastVisitAt: оновлюємо, якщо Altegio дав last_visit_date для цього altegioClientId.
      // Не “затираємо” на null, якщо ключ не знайдений (щоб не втрачати дані при часткових вибірках).
      try {
        if (lastVisitMap && lastVisitMap.size > 0) {
          const aid = Number(client.altegioClientId);
          if (aid && !Number.isNaN(aid)) {
            const lv = lastVisitMap.get(aid);
            if (lv) {
              lastVisitFoundInMap++;
              const current = (client as any).lastVisitAt ? String((client as any).lastVisitAt) : '';
              const currentTs = current ? new Date(current).getTime() : NaN;
              const nextTs = new Date(lv).getTime();
              if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || currentTs !== nextTs)) {
                updates.lastVisitAt = new Date(nextTs).toISOString();
                changedKeys.push('lastVisitAt');
              } else if (Number.isFinite(currentTs) && currentTs === nextTs) {
                lastVisitSkippedAlreadySame++;
              }
            }
          }
        }
      } catch {}

      if (changedKeys.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:152',message:'Skipping client - no changes',data:{directClientId:client.id,altegioClientId:client.altegioClientId,currentSpent:client.spent,nextSpent,currentVisits:client.visits,nextVisits},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // Детальне логування для пропущених клієнтів (видно в Vercel logs)
        console.log('[cron/sync-direct-altegio-metrics] ⏭️ Пропущено клієнта - немає змін', {
          directClientId: client.id,
          altegioClientId: client.altegioClientId,
          firstName: client.firstName,
          lastName: client.lastName,
          instagramUsername: client.instagramUsername,
          currentSpent: client.spent,
          nextSpent,
          currentVisits: client.visits,
          nextVisits,
        });
        
        // Зберігаємо деталі про пропущених клієнтів для response (тільки перші 50)
        if (skippedDetails.length < 50) {
          skippedDetails.push({
            directClientId: client.id,
            altegioClientId: client.altegioClientId,
            reason: 'no_changes',
            currentSpent: client.spent,
            nextSpent,
            currentVisits: client.visits,
            nextVisits,
          });
        }
        
        skippedNoChange++;
        continue;
      }

      const updatedClient = {
        ...client,
        ...updates,
        // НЕ рухаємо updatedAt (це технічний синк)
        updatedAt: client.updatedAt,
      };

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:164',message:'Saving client updates',data:{directClientId:client.id,altegioClientId:client.altegioClientId,changedKeys,updatedClientSpent:updatedClient.spent,updatedClientVisits:updatedClient.visits},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      await saveDirectClient(
        updatedClient,
        'cron-sync-direct-altegio-metrics',
        { altegioClientId: client.altegioClientId, changedKeys },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:169',message:'Client saved successfully',data:{directClientId:client.id,altegioClientId:client.altegioClientId,changedKeys},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      updated++;
      if (changedKeys.includes('lastVisitAt')) lastVisitUpdated++;
      if (samples.length < 20) {
        samples.push({
          directClientId: client.id,
          altegioClientId: client.altegioClientId,
          action: 'saved',
          changedKeys,
        });
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ directClientId: client.id, altegioClientId: client.altegioClientId, error: msg });
      console.error('[cron/sync-direct-altegio-metrics] ❌ Помилка', {
        directClientId: client.id,
        altegioClientId: client.altegioClientId,
        error: msg,
      });
    } finally {
      if (delayMs && i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const ms = Date.now() - startedAt;
  console.log('[cron/sync-direct-altegio-metrics] ✅ Готово', {
    totalClients: allClients.length,
    targets: targets.length,
    processed,
    updated,
    skippedNoAltegioId,
    skippedNoChange,
    fetchedNotFound,
    errors,
    lastVisitMapSize: lastVisitMap?.size || 0,
    lastVisitUpdated,
    lastVisitFoundInMap,
    lastVisitSkippedAlreadySame,
    ms,
  });

  try {
    const isVercelCron = req.headers.get('x-vercel-cron') === '1';
    const via = isVercelCron ? 'vercel' : 'secret';
    await kvWrite.setRaw(
      'direct:cron:sync-direct-altegio-metrics:lastRun',
      JSON.stringify({
        phase: 'done',
        via,
        finishedAt: new Date().toISOString(),
        stats: {
          totalClients: allClients.length,
          targets: targets.length,
          processed,
          updated,
          skippedNoAltegioId,
          skippedNoChange,
          fetchedNotFound,
          errors,
          lastVisitMapSize: lastVisitMap?.size || 0,
          lastVisitUpdated,
          lastVisitFoundInMap,
          lastVisitSkippedAlreadySame,
          ms,
        },
      })
    );
  } catch {}

  return NextResponse.json({
    ok: true,
    stats: {
      totalClients: allClients.length,
      targets: targets.length,
      processed,
      updated,
      skippedNoAltegioId,
      skippedNoChange,
      fetchedNotFound,
      errors,
      lastVisitMapSize: lastVisitMap?.size || 0,
      lastVisitUpdated,
      lastVisitFoundInMap,
      lastVisitSkippedAlreadySame,
      ms,
    },
    samples,
    errorDetails: errorDetails.slice(0, 30),
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  // Логуємо ВСІ запити (навіть неавторизовані) для діагностики
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  
  console.log('[cron/sync-direct-altegio-metrics] 📥 GET request received (ALL REQUESTS)', {
    url: req.url,
    method: 'GET',
    isVercelCron,
    xVercelCron: req.headers.get('x-vercel-cron'),
    userAgent: req.headers.get('user-agent'),
    authorization: req.headers.get('authorization'),
    timestamp: new Date().toISOString(),
    allHeaders,
  });
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:378',message:'GET request received',data:{method:'GET',url:req.url,hasVercelCron:isVercelCron,allHeaders},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  return runSync(req);
}

export async function POST(req: NextRequest) {
  // Логуємо ВСІ запити (навіть неавторизовані) для діагностики
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  
  console.log('[cron/sync-direct-altegio-metrics] 📥 POST request received (ALL REQUESTS)', {
    url: req.url,
    method: 'POST',
    isVercelCron,
    xVercelCron: req.headers.get('x-vercel-cron'),
    userAgent: req.headers.get('user-agent'),
    authorization: req.headers.get('authorization'),
    timestamp: new Date().toISOString(),
    allHeaders,
  });
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync-direct-altegio-metrics/route.ts:396',message:'POST request received',data:{method:'POST',url:req.url,hasVercelCron:isVercelCron,allHeaders},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  return runSync(req);
}

