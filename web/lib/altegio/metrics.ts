// web/lib/altegio/metrics.ts
// Допоміжні функції для витягування “метрик” клієнта з Altegio API (phone / visits / spent)

import { assertAltegioEnv } from '@/lib/altegio/env';
import { getClient } from '@/lib/altegio/clients';

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'web/lib/altegio/metrics.ts:fetchAltegioClientMetrics:entry',message:'Enter fetchAltegioClientMetrics',data:{altegioClientId:params.altegioClientId,hasCompanyId:!!process.env.ALTEGIO_COMPANY_ID},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
    assertAltegioEnv();
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || Number.isNaN(companyId)) {
      return { ok: false, error: 'ALTEGIO_COMPANY_ID not configured' };
    }

    const client = await getClient(companyId, params.altegioClientId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B',location:'web/lib/altegio/metrics.ts:fetchAltegioClientMetrics:afterGetClient',message:'After getClient()',data:{altegioClientId:params.altegioClientId,clientNull:!client,clientKeys:client?Object.keys(client as any).slice(0,40):[],phoneType:client?typeof (client as any).phone:null,hasPhonesArray:Array.isArray((client as any)?.phones),spentType:client?typeof (client as any).spent:null,visitsType:client?typeof (client as any).visits:null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
    if (!client) {
      return { ok: false, error: 'Altegio client not found' };
    }

    const phone = safeTrimString((client as any).phone) || null;
    const visits = safeNumber((client as any).visits);
    const spent = safeNumber((client as any).spent);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'E',location:'web/lib/altegio/metrics.ts:fetchAltegioClientMetrics:parsed',message:'Parsed metrics (no PII)',data:{altegioClientId:params.altegioClientId,phonePresent:!!phone,visitsPresent:visits!==null,spentPresent:spent!==null,visitsValue:visits,spentIsZero:spent===0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'web/lib/altegio/metrics.ts:fetchAltegioClientMetrics:catch',message:'Error in fetchAltegioClientMetrics',data:{altegioClientId:params.altegioClientId,error:msg},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
    return { ok: false, error: msg };
  }
}

