// web/lib/kv.ts
// ❗️НОВЕ: у listCampaigns() додаємо __index_id і гарантуємо obj.id = __index_id, якщо збережений id зламаний.

import { getEnvValue } from '@/lib/env';

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
};

type KvRuntimeConfig = {
  rawBase: string;
  baseCandidates: string[];
  writeToken: string | null;
  readToken: string | null;
};

function normalizeBase(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    // fall back to manual sanitising for non-URL strings
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  let sanitized = trimmed.replace(/\s+$/, '');
  sanitized = sanitized.replace(/\/+$/, '');

  const patterns = [/\/v0\/kv$/i, /\/kv$/i, /\/v0$/i];
  let updated = true;
  while (updated) {
    updated = false;
    for (const pattern of patterns) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '');
        updated = true;
      }
    }
  }

  return sanitized || null;
}

function buildBaseCandidates(rawBase: string): string[] {
  const candidates = new Set<string>();

  const trimmed = rawBase.trim();
  if (trimmed) {
    const noTrailing = trimmed.replace(/\s+$/, '').replace(/\/+$/, '');
    if (noTrailing) {
      candidates.add(noTrailing);

      const lowered = noTrailing.toLowerCase();
      const variants: string[] = [noTrailing];

      if (lowered.endsWith('/v0/kv')) {
        variants.push(noTrailing.slice(0, -'/v0/kv'.length));
      }
      if (lowered.endsWith('/kv')) {
        variants.push(noTrailing.slice(0, -'/kv'.length));
      }
      if (lowered.endsWith('/v0')) {
        variants.push(noTrailing.slice(0, -'/v0'.length));
      }

      for (const variant of variants) {
        if (variant) {
          candidates.add(variant.replace(/\/+$/, ''));
        }
      }
    }
  }

  const normalized = normalizeBase(rawBase);
  if (normalized) {
    candidates.add(normalized.replace(/\/+$/, ''));
  }

  return Array.from(candidates).filter(Boolean);
}

function resolveKvRuntime(): KvRuntimeConfig {
  const rawBase =
    getEnvValue(
      'KV_REST_API_URL',
      'VERCEL_KV_REST_API_URL',
      'VERCEL_KV_URL',
      'KV_URL',
    )?.trim() ?? '';

  const writeToken =
    getEnvValue(
      'KV_REST_API_TOKEN',
      'VERCEL_KV_REST_API_TOKEN',
      'KV_REST_API_WRITE_ONLY_TOKEN',
      'KV_WRITE_ONLY_TOKEN',
      'KV_TOKEN',
    )?.trim() ?? null;

  const readToken =
    getEnvValue(
      'KV_REST_API_READ_ONLY_TOKEN',
      'VERCEL_KV_REST_API_READ_ONLY_TOKEN',
      'KV_READ_ONLY_TOKEN',
      'KV_REST_API_TOKEN',
      'VERCEL_KV_REST_API_TOKEN',
      'KV_TOKEN',
    )?.trim() ?? writeToken;

  const baseCandidates = buildBaseCandidates(rawBase);

  return {
    rawBase,
    baseCandidates,
    writeToken,
    readToken: readToken ?? null,
  };
}

export function getKvConfigStatus() {
  const { baseCandidates, writeToken, readToken } = resolveKvRuntime();
  return {
    hasBaseUrl: baseCandidates.length > 0,
    baseCandidates: baseCandidates.slice(),
    hasWriteToken: Boolean(writeToken),
    hasReadToken: Boolean(readToken),
  } as const;
}

async function rest(
  path: string,
  opts: RequestInit = {},
  ro = false,
  allow404 = false,
): Promise<Response> {
  const { baseCandidates, writeToken, readToken } = resolveKvRuntime();

  if (!baseCandidates.length) {
    throw new Error('KV_REST_API_URL missing');
  }
  const token = ro ? readToken : writeToken;
  if (!token) {
    throw new Error(ro ? 'KV_REST_API_READ_ONLY_TOKEN missing' : 'KV_REST_API_TOKEN missing');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let lastError: Error | null = null;

  for (let index = 0; index < baseCandidates.length; index += 1) {
    const base = baseCandidates[index];
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const targetPath = path.replace(/^\/+/, '');
    const url = new URL(targetPath, normalizedBase).toString();

    let res: Response;
    try {
      res = await fetch(url, { ...opts, headers, cache: 'no-store' });
    } catch (error) {
      lastError = new Error(
        `KV request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (res.ok) {
      return res;
    }

    if (res.status === 404) {
      if (allow404) {
        return res;
      }
      // ключ може бути відсутній або ми звернулись не за тією адресою —
      // пробуємо наступного кандидата
      lastError = new Error(`KV responded with 404 at ${url}`);
      continue;
    }

    const error = new Error(`KV responded with ${res.status} at ${url}`);
    (error as any).status = res.status;
    throw error;
  }

  if (allow404) {
    return new Response(null, { status: 404 });
  }

  throw lastError ?? new Error('KV request failed');
}

async function kvGetRaw(key: string) {
  const { baseCandidates, readToken } = resolveKvRuntime();
  if (!baseCandidates.length || !readToken) return null as string | null;
  const res = await rest(`v0/kv/${encodeURIComponent(key)}`, {}, true, true).catch(() => null);
  if (!res || res.status === 404) return null;

  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const candidate =
        (parsed as any).result ??
        (parsed as any).value ??
        (parsed as any).data ??
        null;
      if (typeof candidate === 'string') return candidate;
      if (candidate && typeof candidate === 'object') {
        const nested = (candidate as any).value ?? (candidate as any).result ?? null;
        if (typeof nested === 'string') return nested;
      }
    }
  } catch {
    // ignore, fall back to raw text
  }

  return text;
}

async function kvSetRaw(key: string, value: string) {
  const { baseCandidates, writeToken } = resolveKvRuntime();
  if (!baseCandidates.length) {
    throw new Error('KV_REST_API_URL missing');
  }
  if (!writeToken) {
    throw new Error('KV_REST_API_TOKEN missing');
  }

  await rest(`v0/kv/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

// — robust LRANGE парсер (масив / {result} / {data} / рядок)
async function kvLRange(key: string, start = 0, stop = -1) {
  const { baseCandidates, readToken } = resolveKvRuntime();
  if (!baseCandidates.length || !readToken) return [] as string[];
  const res = await rest(
    `v0/kv/lrange/${encodeURIComponent(key)}/${start}/${stop}`,
    {},
    true,
    true,
  ).catch(() => null);
  if (!res) return [] as string[];

  let txt = '';
  try { txt = await res.text(); } catch { return []; }

  let payload: any = null;
  try { payload = JSON.parse(txt); } catch { payload = txt; }

  let arr: any[] = [];
  if (Array.isArray(payload)) arr = payload;
  else if (payload && Array.isArray(payload.result)) arr = payload.result;
  else if (payload && Array.isArray(payload.data)) arr = payload.data;
  else if (typeof payload === 'string') {
    try {
      const again = JSON.parse(payload);
      if (Array.isArray(again)) arr = again;
      else if (again && Array.isArray(again.result)) arr = again.result;
      else if (again && Array.isArray(again.data)) arr = again.data;
    } catch {}
  }

  return arr
    .map((x: any) =>
      typeof x === 'string'
        ? x
        : (x?.value ?? x?.member ?? x?.id ?? '')
    )
    .filter(Boolean)
    .map(String);
}

// === універсальна нормалізація будь-якої форми id ===
function normalizeIdRaw(raw: any, depth = 6): string {
  if (raw == null || depth <= 0) return '';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    let s = raw.trim();
    for (let i = 0; i < 5; i++) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string' || typeof parsed === 'number') {
          return normalizeIdRaw(parsed, depth - 1);
        }
        if (parsed && typeof parsed === 'object') {
          const cand = (parsed as any).value ?? (parsed as any).id ?? (parsed as any).member ?? '';
          if (cand) return normalizeIdRaw(cand, depth - 1);
        }
        break;
      } catch { break; }
    }
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
    const m = s.match(/\d{10,}/);
    if (m) return m[0];
    return '';
  }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeIdRaw(cand, depth - 1);
  }
  return '';
}

export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },

  // 🔧 ГАРАНТУЄМО коректний id:
  // - додаємо __index_id (id з індексу LIST)
  // - якщо obj.id зіпсований/порожній — підставляємо __index_id
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    const ids = (await kvLRange(campaignKeys.INDEX_KEY, 0, -1)) as string[];
    const out: T[] = [];

    for (const indexId of ids) {
      const raw = await kvGetRaw(campaignKeys.ITEM_KEY(indexId));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);

        const safeFromObj = normalizeIdRaw(obj?.id);
        const safeId = safeFromObj || String(indexId);

        obj.__index_id = String(indexId); // ← для надійності
        obj.id = safeId;                  // ← тепер завжди є коректний id (рядок-число)

        if (!obj.created_at) {
          const ts = Number(safeId);
          if (Number.isFinite(ts)) obj.created_at = ts;
        }
        out.push(obj);
      } catch {
        // ігноруємо биті JSON
      }
    }
    return out;
  },
};

export const kvWrite = {
  async setRaw(key: string, value: string) {
    return kvSetRaw(key, value);
  },
  async lpush(key: string, value: string) {
    const { baseCandidates, writeToken } = resolveKvRuntime();
    if (!baseCandidates.length) {
      throw new Error('KV_REST_API_URL missing');
    }
    if (!writeToken) {
      throw new Error('KV_REST_API_TOKEN missing');
    }

    await rest(`v0/kv/lpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  },
  async ltrim(key: string, start: number, stop: number) {
    const { baseCandidates, writeToken } = resolveKvRuntime();
    if (!baseCandidates.length) {
      throw new Error('KV_REST_API_URL missing');
    }
    if (!writeToken) {
      throw new Error('KV_REST_API_TOKEN missing');
    }

    await rest(`v0/kv/ltrim/${encodeURIComponent(key)}/${start}/${stop}`, {
      method: 'POST',
    });
  },
  async createCampaign(input: any) {
    const id = String(input?.id || Date.now());
    const created_at =
      typeof input?.created_at === 'number'
        ? input.created_at
        : (Number(id) && Number.isFinite(Number(id)) ? Number(id) : Date.now());

    const item = {
      id,
      name: input?.name || 'UI-created',
      created_at,
      active: Boolean(input?.active ?? false),
      base_pipeline_id: input?.base_pipeline_id ?? null,
      base_status_id: input?.base_status_id ?? null,
      base_pipeline_name: input?.base_pipeline_name ?? null,
      base_status_name: input?.base_status_name ?? null,
      rules: input?.rules || {},
      exp: input?.exp || {},
      v1_count: Number(input?.v1_count ?? 0),
      v2_count: Number(input?.v2_count ?? 0),
      exp_count: Number(input?.exp_count ?? 0),
      deleted: false,
    };

    await kvSetRaw(campaignKeys.ITEM_KEY(id), JSON.stringify(item));
    await rest(`v0/kv/lpush/${encodeURIComponent(campaignKeys.INDEX_KEY)}`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => {});
    return item;
  },
};
