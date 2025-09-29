// web/lib/kv.ts
// KV helper: гарантуємо, що listCampaigns() повертає об'єкти з полем id (і created_at, якщо його можна взяти з id).

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
};

// --- низькорівневі REST-обгортки (залиште ваші існуючі; нижче — безпечна реалізація) ---
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
    // Vercel KV REST повертає [{value:"id"}] або ["id"], підтримуємо обидва
    const arr = await res.json();
    return arr.map((x: any) => (typeof x === 'string' ? x : x?.value)).filter(Boolean);
  } catch {
    return [];
  }
}

// --- публічні API для коду застосунку ---
export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },

  // ВАЖЛИВО: гарантуємо id/created_at
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    const ids = (await kvLRange(campaignKeys.INDEX_KEY, 0, -1)) as string[];
    const out: T[] = [];

    for (const id of ids) {
      const raw = await kvGetRaw(campaignKeys.ITEM_KEY(id));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        // якщо в JSON немає id — підставляємо його з індексу
        if (!obj.id) obj.id = id;
        // якщо немає created_at — пробуємо взяти з id (timestamp)
        if (!obj.created_at) {
          const ts = Number(id);
          if (Number.isFinite(ts)) obj.created_at = ts;
        }
        out.push(obj);
      } catch {
        // пропускаємо биті JSON
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
    if (!BASE || !WR_TOKEN) return;
    await rest(`lpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }).catch(() => {});
  },
};

export type { };
