// web/app/api/admin/status/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';
import type { Campaign } from '@/lib/types';

const PAIR_INDEX = (p: number, s: number) => `kc:index:cards:${p}:${s}`;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// авторизація: Bearer або ?pass=
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  try {
    if (
      (expected && bearer && bearer === expected) ||
      (expected && passParam && passParam === expected)
    ) {
      return true;
    }
    await assertAdmin(req); // запасний шлях
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await ensureAdmin(req))) {
    return json(
      {
        ok: false,
        error:
          'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>',
        have_ADMIN_PASS_env: Boolean(process.env.ADMIN_PASS),
      },
      401
    );
  }

  // 0) Базова діагностика ENV
  const env = {
    has_ADMIN_PASS: Boolean(process.env.ADMIN_PASS),
    has_KEYCRM_API_TOKEN: Boolean(process.env.KEYCRM_API_TOKEN),
    KEYCRM_BASE_URL: process.env.KEYCRM_BASE_URL || null,
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
  };

  // 1) Знімок індексу кампаній
  const indexKey = 'campaigns:index';
  let index: string[] = [];
  try {
    index = (await kvZRange(indexKey, 0, -1)) || [];
  } catch (e: any) {
    return json({
      ok: false,
      error: 'Failed to read campaigns:index',
      details: String(e?.message || e),
      env,
    });
  }

  const sampleIds = index.slice(0, 5);

  // 2) Спроба завантажити перші 5 кампаній
  const sample: Array<{
    id: string;
    key: string;
    exists: boolean;
    valueType?: string;
    parsed?: {
      name?: string;
      active?: boolean;
      base_pipeline_id?: number;
      base_status_id?: number;
      has_rules?: boolean;
    };
  }> = [];

  for (const id of sampleIds) {
    const key = `campaigns:${id}`;
    const raw = await kvGet<any>(key);
    const item: any = { id, key, exists: Boolean(raw) };
    if (raw) {
      const val = typeof raw === 'string' ? raw : JSON.stringify(raw);
      item.valueType = typeof raw === 'string' ? 'string' : typeof raw;
      try {
        const parsed: Campaign =
          typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
        item.parsed = {
          name: (parsed as any).name,
          active: (parsed as any).active,
          base_pipeline_id: (parsed as any).base_pipeline_id,
          base_status_id: (parsed as any).base_status_id,
          has_rules: Boolean((parsed as any).rules),
        };
      } catch {
        // не JSON — залишимо як є
      }
    }
    sample.push(item);
  }

  // 3) Якщо перший запис таки існує — спробуємо показати його pair-індекс
  let pair_key: string | null = null;
  let pair_index_sample: string[] = [];
  const firstParsed = sample.find((x) => x.parsed)?.parsed;
  if (firstParsed?.base_pipeline_id && firstParsed?.base_status_id) {
    pair_key = PAIR_INDEX(firstParsed.base_pipeline_id, firstParsed.base_status_id);
    try {
      // останні 20
      pair_index_sample = (await kvZRange(pair_key, -20, -1)) || [];
      if (!pair_index_sample.length) {
        const all = await kvZRange(pair_key, 0, -1);
        pair_index_sample = (all || []).slice(-20);
      }
    } catch {
      pair_index_sample = [];
    }
  }

  return json({
    ok: true,
    env,
    campaigns: {
      index_count: index.length,
      index_sample_ids: sampleIds,
      sample, // детальна інформація по першим 5
    },
    indexes: {
      pair_key,
      pair_index_sample_count: pair_index_sample.length,
      pair_index_sample,
    },
    debug: {
      request_host: req.headers.get('host'),
      url: new URL(req.url).toString(),
    },
  });
}
