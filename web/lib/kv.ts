// web/lib/kv.ts
// KV helper: безпечні обгортки + нормалізація campaign.id/created_at,
// а також createCampaign() для /api/campaigns.

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
};

// ====== low-level REST helpers ======
const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const WR_TOKEN = process.env.KV_REST_API_TOKEN || '';
const RD_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || WR_TOKEN;

async function rest(path: string, opts: RequestInit = {}, ro = false) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ro ? RD_TOKEN : WR_TOKEN}`,
  };
  const res = await fetch(`${BASE}/${path}`, { ...opts, headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}

async function kvGetRaw(key: string) {
  if (!BASE || !RD_TOKEN) return null as string | null;
  const res = await rest(`get/${encodeURIComponent(key)}`, {}, true).catch(() => null);
  if (!res) return null;
  return res.text();
}
async function kvSetRaw(key: string, value: string) {
  if (!BASE || !WR_TOKEN) return;
  await rest(`set/${encodeURIComponent(key)}`, { method: 'POST', body: value }).catch(() => {});
}
async function kvLRange(key: string, start = 0, stop = -1) {
  if (!BASE || !RD_TOKEN) return [] as string[];
  const res = await rest(`lrange/${encodeURIComponent(key)}/${start}/${stop}`, {}, true).catch(() => null);
  if (!res) return [] as string[];
  try {
    // Підтримуємо формати ["id"] та [{value:"id"}]
    const arr = await res.json();
    return arr.map((x: any) => (typeof x === 'string' ? x : x?.value)).filter(Boolean);
  } catch {
    return [];
  }
}
async function kvLPush(key: string, value: string) {
  if (!BASE || !WR_TOKEN) return;
  await rest(`lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

// ====== public API ======
export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },

  // Повертаємо кампанії гарантовано з id та created_at (якщо можливо витягнути з id)
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    const ids = (await kvLRange(campaignKeys.INDEX_KEY, 0, -1)) as string[];
    const out: T[] = [];

    for (const id of ids) {
      const raw = await kvGetRaw(campaignKeys.ITEM_KEY(id));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (!obj.id) obj.id = id;
        if (!obj.created_at) {
          const ts = Number(id);
          if (Number.isFinite(ts)) obj.created_at = ts;
        }
        out.push(obj);
      } catch {
        // ignore broken json
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
    return kvLPush(key, value);
  },

  // Створення кампанії: запис елемента + додавання id у LIST-індекс
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
    await kvLPush(campaignKeys.INDEX_KEY, id);

    return item;
  },
};
