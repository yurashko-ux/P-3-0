// web/lib/altegio/metrics.ts
// Допоміжні функції для витягування “метрик” клієнта з Altegio API (phone / visits / spent)

import { appendFileSync } from 'fs';
import { join } from 'path';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { getClient } from '@/lib/altegio/clients';

const DEBUG_LOG = join(process.cwd(), '..', '.cursor', 'debug.log');
function debugLog(data: Record<string, unknown>) {
  try { appendFileSync(DEBUG_LOG, JSON.stringify(data) + '\n'); } catch {}
}

export type AltegioClientMetrics = {
  phone?: string | null;
  visits?: number | null;
  spent?: number | null;
};

function safeTrimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Витягує (phone/visits/spent) для конкретного клієнта з Altegio API.
 * Важливо: тільки fetch, без запису в Prisma.
 */
export async function fetchAltegioClientMetrics(params: {
  altegioClientId: number;
}): Promise<{ ok: true; metrics: AltegioClientMetrics } | { ok: false; error: string }> {
  try {
    assertAltegioEnv();
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || Number.isNaN(companyId)) {
      return { ok: false, error: 'ALTEGIO_COMPANY_ID not configured' };
    }

    const client = await getClient(companyId, params.altegioClientId);
    if (!client) {
      return { ok: false, error: 'Altegio client not found' };
    }

    const phone = safeTrimString((client as any).phone) || null;
    // Altegio API може повертати visits_count або success_visits_count замість visits
    const visits =
      safeNumber((client as any).visits) ??
      safeNumber((client as any).visits_count) ??
      safeNumber((client as any).success_visits_count);
    const spent = safeNumber((client as any).spent) ?? safeNumber((client as any).total_spent);

    // #region agent log
    const visitKeys = Object.keys(client).filter(k => k.toLowerCase().includes('visit'));
    const visitValues = visitKeys.reduce((acc: Record<string, unknown>, k) => { acc[k] = (client as any)[k]; return acc; }, {});
    debugLog({ location: 'metrics.ts:51', message: 'Altegio API visits fields', altegioClientId: params.altegioClientId, visits, visits_count: safeNumber((client as any).visits_count), success_visits_count: safeNumber((client as any).success_visits_count), visitKeys, visitValues, allKeys: Object.keys(client), hypothesisId: 'A', timestamp: Date.now() });
    // #endregion

    return {
      ok: true,
      metrics: {
        phone,
        visits,
        spent,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

