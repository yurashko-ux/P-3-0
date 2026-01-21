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
  if (!okCron(req)) {
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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C',location:'web/app/api/cron/sync-direct-altegio-metrics/route.ts:runSync:start',message:'Cron sync start',data:{okCron:true,delayMs,limit,hasCompanyId:!!process.env.ALTEGIO_COMPANY_ID},timestamp:Date.now()})}).catch(()=>{});
  // #endregion agent log

  const allClients = await getAllDirectClients();
  const targets = allClients.filter((c) => typeof c.altegioClientId === 'number' && (c.altegioClientId || 0) > 0);

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

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; changedKeys?: string[] }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const client = targets[i];
    if (!client.altegioClientId) continue;
    if (limit && processed >= limit) break;
    processed++;

    try {
      const res = await fetchAltegioClientMetrics({ altegioClientId: client.altegioClientId });
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

      const updates: any = {};
      const changedKeys: string[] = [];

      if (nextPhone && (!client.phone || client.phone.trim() !== nextPhone)) {
        updates.phone = nextPhone;
        changedKeys.push('phone');
      }
      if (nextVisits !== null && client.visits !== nextVisits) {
        updates.visits = nextVisits;
        changedKeys.push('visits');
      }
      if (nextSpent !== null && client.spent !== nextSpent) {
        updates.spent = nextSpent;
        changedKeys.push('spent');
      }

      // lastVisitAt: оновлюємо, якщо Altegio дав last_visit_date для цього altegioClientId.
      // Не “затираємо” на null, якщо ключ не знайдений (щоб не втрачати дані при часткових вибірках).
      try {
        if (lastVisitMap && lastVisitMap.size > 0) {
          const lv = lastVisitMap.get(client.altegioClientId);
          if (lv) {
            const current = (client as any).lastVisitAt ? String((client as any).lastVisitAt) : '';
            const currentTs = current ? new Date(current).getTime() : NaN;
            const nextTs = new Date(lv).getTime();
            if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || currentTs !== nextTs)) {
              updates.lastVisitAt = new Date(nextTs).toISOString();
              changedKeys.push('lastVisitAt');
            }
          }
        }
      } catch {}

      if (changedKeys.length === 0) {
        skippedNoChange++;
        continue;
      }

      // #region agent log
      if (processed <= 3) {
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'D',location:'web/app/api/cron/sync-direct-altegio-metrics/route.ts:runSync:decision',message:'Prepared updates for client',data:{idx:processed,altegioClientId:client.altegioClientId,changedKeys,hasPhoneUpdate:changedKeys.includes('phone'),hasVisitsUpdate:changedKeys.includes('visits'),hasSpentUpdate:changedKeys.includes('spent')},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion agent log

      const updatedClient = {
        ...client,
        ...updates,
        // НЕ рухаємо updatedAt (це технічний синк)
        updatedAt: client.updatedAt,
      };

      await saveDirectClient(
        updatedClient,
        'cron-sync-direct-altegio-metrics',
        { altegioClientId: client.altegioClientId, changedKeys },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );

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
      ms,
    },
    samples,
    errorDetails: errorDetails.slice(0, 30),
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return runSync(req);
}

export async function POST(req: NextRequest) {
  return runSync(req);
}

