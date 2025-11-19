// web/lib/kv.ts
// ❗️НОВЕ: у listCampaigns() додаємо __index_id і гарантуємо obj.id = __index_id, якщо збережений id зламаний.

import { getEnvValue } from '@/lib/env';

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
  LEGACY_INDEX_KEY: 'campaigns:index',
  LEGACY_ITEM_KEY: (id: string) => `campaigns:${id}`,
  CMP_INDEX_KEY: 'cmp:ids',
  CMP_INDEX_LIST_KEY: 'cmp:ids:list',
  CMP_ITEM_KEY: (id: string) => `cmp:item:${id}`,
} as const;

export const keycrmKeys = {
  PIPELINES_SNAPSHOT_KEY: 'keycrm:pipelines:snapshot',
} as const;

export const expTrackingKeys = {
  TRACK_KEY: (campaignId: string, cardId: string) => `exp:track:${campaignId}:${cardId}`,
} as const;

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
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.replace(/\s+$/, '').replace(/\/+$/, '');
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  // Завжди віддаємо перевагу нормалізованій origin-адресі без службових сегментів.
  const normalisedOrigin = normalizeBase(rawBase);
  push(normalisedOrigin);
  if (normalisedOrigin) {
    push(`${normalisedOrigin}/v0/kv`);
  }

  const trimmed = rawBase.trim();
  if (trimmed) {
    const noTrailing = trimmed.replace(/\s+$/, '').replace(/\/+$/, '');
    push(noTrailing);
    if (!/\/v0\/kv$/i.test(noTrailing)) {
      push(`${noTrailing}/v0/kv`);
    }

    const lowered = noTrailing.toLowerCase();
    if (lowered.endsWith('/v0/kv')) {
      push(noTrailing.slice(0, -'/v0/kv'.length));
    }
    if (lowered.endsWith('/kv')) {
      push(noTrailing.slice(0, -'/kv'.length));
    }
    if (lowered.endsWith('/v0')) {
      push(noTrailing.slice(0, -'/v0'.length));
    }
  }

  return ordered;
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

  let fallback404: Response | null = null;

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
      if (allow404 && !fallback404) {
        fallback404 = res.clone();
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
    return fallback404 ?? new Response(null, { status: 404 });
  }

  throw lastError ?? new Error('KV request failed');
}

async function kvGetRaw(key: string) {
  const { baseCandidates, readToken } = resolveKvRuntime();
  if (!baseCandidates.length || !readToken) return null as string | null;
  const res = await rest(`get/${encodeURIComponent(key)}`, {}, true, true).catch(() => null);
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
        if (nested && typeof nested === 'object') {
          try {
            return JSON.stringify(nested);
          } catch {
            /* ignore */
          }
        }
        try {
          return JSON.stringify(candidate);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    // ignore, fall back to raw text
  }

  // деякі namespace повертають base64-рядок без JSON-обгортки
  if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      if (decoded) {
        return decoded;
      }
    } catch {
      // не вдалося розкодувати — повертаємо сирий текст
    }
  }

  return text;
}

type KeycrmPipelineSnapshot = {
  pipelines: any[];
  fetchedAt: string;
  storedAt: number;
};

function parsePipelineSnapshot(raw: string | null): KeycrmPipelineSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const pipelines = Array.isArray((parsed as any).pipelines) ? (parsed as any).pipelines : null;
    if (!pipelines) return null;
    const fetchedAt = typeof (parsed as any).fetchedAt === 'string'
      ? (parsed as any).fetchedAt
      : new Date().toISOString();
    const storedAtRaw = (parsed as any).storedAt;
    const storedAt = typeof storedAtRaw === 'number' && Number.isFinite(storedAtRaw)
      ? storedAtRaw
      : Date.now();
    return { pipelines, fetchedAt, storedAt };
  } catch {
    return null;
  }
}

async function kvSetRaw(key: string, value: string) {
  const { baseCandidates, writeToken } = resolveKvRuntime();
  if (!baseCandidates.length) {
    throw new Error('KV_REST_API_URL missing');
  }
  if (!writeToken) {
    throw new Error('KV_REST_API_TOKEN missing');
  }

  const body = JSON.stringify({ value });

  try {
    await rest(`set/${encodeURIComponent(key)}`, {
      method: 'POST',
      body,
    });
    return;
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;
    if (status !== 405 && status !== 400 && status !== 501) {
      throw error;
    }
  }

  await rest(`set/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body,
  });
}

// — robust LRANGE парсер (масив / {result} / {data} / рядок)
async function kvLRange(key: string, start = 0, stop = -1) {
  const { baseCandidates, readToken } = resolveKvRuntime();
  if (!baseCandidates.length || !readToken) return [] as string[];
  const res = await rest(
    `lrange/${encodeURIComponent(key)}/${start}/${stop}`,
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
    .map((x: any) => {
      if (typeof x === 'string') return x;
      const candidate = x?.value ?? x?.member ?? x?.id ?? '';
      if (!candidate) return '';
      if (typeof candidate === 'string') return candidate;
      try {
        return JSON.stringify(candidate);
      } catch {
        return '';
      }
    })
    .filter((value: string) => Boolean(value) && value !== '[object Object]')
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

function canonicaliseId(raw: unknown): string | null {
  if (raw == null) return null;
  const str =
    typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : '';
  if (!str) return null;
  const normalised = normalizeIdRaw(str);
  return normalised || str;
}

function collectIdCandidates(raw: string): string[] {
  const results: string[] = [];
  const stack: unknown[] = [raw];
  const visited = new Set<unknown>();

  while (stack.length) {
    const value = stack.pop();
    if (value == null) continue;
    if (visited.has(value)) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      results.push(trimmed);
      try {
        stack.push(JSON.parse(trimmed));
      } catch {
        /* ignore */
      }
      continue;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      results.push(String(value));
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    if (typeof value === 'object') {
      visited.add(value);
      const record = value as Record<string, unknown>;
      for (const key of ['value', 'result', 'data', 'items', 'ids', 'list', 'members']) {
        if (key in record) stack.push(record[key]);
      }
    }
  }

  return results;
}

function parseCampaignObject(raw: string): Record<string, any> | null {
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

    if (
      'id' in record ||
      'name' in record ||
      'base' in record ||
      'rules' in record ||
      'v1' in record ||
      'v2' in record
    ) {
      return { ...(record as Record<string, any>) };
    }

    for (const key of ['value', 'result', 'data', 'payload', 'item', 'campaign']) {
      if (key in record) stack.push(record[key]);
    }
  }

  return null;
}

export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },
  async keycrmPipelinesSnapshot(): Promise<KeycrmPipelineSnapshot | null> {
    const raw = await kvGetRaw(keycrmKeys.PIPELINES_SNAPSHOT_KEY);
    return parsePipelineSnapshot(raw);
  },

  // 🔧 ГАРАНТУЄМО коректний id:
  // - додаємо __index_id (id з індексу LIST)
  // - якщо obj.id зіпсований/порожній — підставляємо __index_id
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    type VariantBucket = Map<string, Set<string>>;

    const order: string[] = [];
    const variants: VariantBucket = new Map();

    const remember = (raw: unknown) => {
      const canonical = canonicaliseId(raw);
      if (!canonical) return;
      if (/[\[\]\{\}]/.test(canonical)) return;

      if (!variants.has(canonical)) {
        variants.set(canonical, new Set<string>());
        order.push(canonical);
      }

      const bucket = variants.get(canonical)!;
      bucket.add(canonical);

      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed && trimmed !== canonical && !/[\[\]\{\}]/.test(trimmed)) {
          bucket.add(trimmed);
        }
      }
    };

    const loadIndex = async (key: string) => {
      if (key !== campaignKeys.CMP_INDEX_KEY) {
        try {
          const list = (await kvLRange(key, 0, -1)) as string[];
          for (const entry of list) remember(entry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/WRONGTYPE/i.test(message)) {
            throw error;
          }
        }
      }

      const raw = await kvGetRaw(key);
      if (raw) {
        const candidates = collectIdCandidates(raw);
        for (const entry of candidates) remember(entry);
      }
    };

    for (const key of [
      campaignKeys.CMP_INDEX_KEY,
      campaignKeys.INDEX_KEY,
      campaignKeys.LEGACY_INDEX_KEY,
      campaignKeys.CMP_INDEX_LIST_KEY,
    ]) {
      await loadIndex(key);
    }

    const itemKeyFactories = [
      campaignKeys.CMP_ITEM_KEY,
      campaignKeys.ITEM_KEY,
      campaignKeys.LEGACY_ITEM_KEY,
    ];

    const out: T[] = [];

    for (const canonical of order) {
      const seenKeys = new Set<string>();
      const candidateIds = Array.from(variants.get(canonical) ?? new Set([canonical]));

      for (const idVariant of candidateIds) {
        for (const buildKey of itemKeyFactories) {
          seenKeys.add(buildKey(idVariant));
        }
      }

      for (const buildKey of itemKeyFactories) {
        seenKeys.add(buildKey(canonical));
      }

      let parsed: Record<string, any> | null = null;
      for (const key of seenKeys) {
        const raw = await kvGetRaw(key);
        if (!raw) continue;
        const candidate = parseCampaignObject(raw);
        if (candidate) {
          parsed = candidate;
          break;
        }
      }

      if (!parsed) continue;

      const safeId = canonicaliseId(parsed.id) ?? canonical;

      parsed.__index_id = canonical;
      parsed.id = safeId ?? canonical;

      if (!parsed.created_at) {
        const ts = Number(parsed.id);
        if (Number.isFinite(ts)) parsed.created_at = ts;
      }

      out.push(parsed as T);
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

    const body = JSON.stringify({ value });

    try {
      await rest(`lpush/${encodeURIComponent(key)}`, {
        method: 'POST',
        body,
      });
      return;
    } catch (error) {
      const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;
      if (status !== 405 && status !== 400 && status !== 501) {
        throw error;
      }
    }

    await rest(`lpush/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body,
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

    try {
      await rest(`ltrim/${encodeURIComponent(key)}/${start}/${stop}`, {
        method: 'POST',
      });
      return;
    } catch (error) {
      const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;
      if (status !== 405 && status !== 400 && status !== 501) {
        throw error;
      }
    }

    await rest(`ltrim/${encodeURIComponent(key)}/${start}/${stop}`, {
      method: 'PUT',
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
    await rest(`lpush/${encodeURIComponent(campaignKeys.INDEX_KEY)}`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => {});
    return item;
  },
  async keycrmPipelinesSnapshot(snapshot: KeycrmPipelineSnapshot) {
    const payload = JSON.stringify({ ...snapshot, storedAt: snapshot.storedAt ?? Date.now() });
    await kvSetRaw(keycrmKeys.PIPELINES_SNAPSHOT_KEY, payload);
  },
  // EXP tracking: зберегти timestamp переміщення картки в базову воронку
  async setExpTracking(campaignId: string, cardId: string, data: {
    timestamp: number;
    basePipelineId: number | string | null;
    baseStatusId: number | string | null;
  }) {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    const value = JSON.stringify({
      campaignId,
      cardId,
      timestamp: data.timestamp,
      basePipelineId: data.basePipelineId,
      baseStatusId: data.baseStatusId,
    });
    await kvSetRaw(key, value);
  },
  // EXP tracking: отримати timestamp переміщення
  async getExpTracking(campaignId: string, cardId: string): Promise<{
    campaignId: string;
    cardId: string;
    timestamp: number;
    basePipelineId: number | string | null;
    baseStatusId: number | string | null;
  } | null> {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    const raw = await kvRead.getRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  // EXP tracking: видалити tracking (після переміщення в EXP або якщо картка більше не в базовій воронці)
  async deleteExpTracking(campaignId: string, cardId: string) {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    const { baseCandidates, writeToken } = resolveKvRuntime();
    if (!baseCandidates.length || !writeToken) return;
    
    try {
      await rest(`del/${encodeURIComponent(key)}`, { method: 'POST' });
    } catch {
      // Ігноруємо помилки видалення
    }
  },
};
