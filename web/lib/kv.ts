// web/lib/kv.ts
// ... верх файлу залишаємо як є (типи/константи/warnEnv/pickToken/kvFetch/kvGet/kvSet/kvLRange/kvLPush) ...

/** Нормалізує значення з індексу:
 * - якщо це JSON рядок типу {"value":"1759..."}, повертає "1759..."
 * - інакше повертає як є
 */
function normalizeId(id: string): string {
  if (!id) return id;
  if (id[0] !== '{') return id;
  try {
    const obj = JSON.parse(id);
    if (obj && typeof obj.value === 'string' && obj.value) return obj.value;
  } catch { /* ignore */ }
  return id;
}

// Public read helpers
export const kvRead = {
  async getRaw(key: string) {
    return kvGet<string>(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },
  async listCampaigns(): Promise<Campaign[]> {
    // Primary index
    let ids: string[] = [];
    try {
      ids = (await kvLRange(INDEX_KEY, 0, -1)).map(normalizeId);
    } catch (e) {
      console.warn('[kv] listCampaigns primary index read failed:', (e as Error).message);
    }

    // Backward-compat: legacy key
    if (!ids || ids.length === 0) {
      try {
        const legacy = await kvLRange('campaigns:index', 0, -1);
        if (legacy?.length) ids = legacy.map(normalizeId);
      } catch {
        // ignore
      }
    }

    const items: Campaign[] = [];
    for (const id of ids) {
      try {
        const raw = await kvGet<string>(ITEM_KEY(id));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Campaign;
        items.push(parsed);
      } catch (e) {
        console.warn('[kv] failed to read/parse item', id, (e as Error).message);
      }
    }
    return items;
  },
};

// Public write helpers
export const kvWrite = {
  async setRaw(key: string, value: string) {
    await kvSet(key, value);
  },
  async lpush(key: string, value: string) {
    // гарантуємо, що пушимо чистий id, а не {"value": "..."} як рядок
    await kvLPush(key, String(value));
  },
  async createCampaign(input: Partial<Campaign>): Promise<Campaign> {
    const id = (input.id ?? Date.now().toString()).toString();
    const full: Campaign = {
      id,
      name: input.name ?? 'Unnamed',
      created_at: Number(id) || Date.now(),
      active: input.active ?? true,
      base_pipeline_id: input.base_pipeline_id,
      base_status_id: input.base_status_id,
      base_pipeline_name: input.base_pipeline_name ?? null,
      base_status_name: input.base_status_name ?? null,
      rules: input.rules ?? {},
      exp: input.exp ?? {},
      v1_count: input.v1_count ?? 0,
      v2_count: input.v2_count ?? 0,
      exp_count: input.exp_count ?? 0,
    };

    await kvSet(ITEM_KEY(id), JSON.stringify(full));
    await kvLPush(INDEX_KEY, id);
    // на час сумісності — пушимо і в legacy індекс
    try { await kvLPush('campaigns:index', id); } catch { /* ignore */ }

    return full;
  },
};

export const campaignKeys = {
  INDEX_KEY,
  ITEM_KEY,
};
