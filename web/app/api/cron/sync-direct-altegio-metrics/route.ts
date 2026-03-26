// web/app/api/cron/sync-direct-altegio-metrics/route.ts
// Щоденний cron: синхронізація phone/visits/spent з Altegio API для всіх Direct клієнтів з altegioClientId

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';
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
  

  // lastVisitAt більше не оновлюється кроном — тільки вебхук (attendance=1) та ручна синхронізація.

  let processed = 0;
  let updated = 0;
  let skippedNoAltegioId = allClients.length - targets.length;
  let skippedNoChange = 0;
  let fetchedNotFound = 0;
  let errors = 0;

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; changedKeys?: string[] }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];
  const skippedDetails: Array<{ directClientId: string; altegioClientId: number; reason: string; currentSpent?: number | null; nextSpent?: number | null; currentVisits?: number | null; nextVisits?: number | null }> = [];

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
      

      // lastVisitAt: оновлюємо, якщо Altegio дав last_visit_date для цього altegioClientId.
      // Не “затираємо” на null, якщо ключ не знайдений (щоб не втрачати дані при часткових вибірках).
      if (changedKeys.length === 0) {
        
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


      await saveDirectClient(
        updatedClient,
        'cron-sync-direct-altegio-metrics',
        { altegioClientId: client.altegioClientId, changedKeys },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );
      

      updated++;
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
  
  
  return runSync(req);
}

