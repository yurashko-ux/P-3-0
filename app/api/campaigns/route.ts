// Сховище: Vercel KV через REST (KV_REST_API_URL, KV_REST_API_TOKEN). Якщо їх нема — тимчасове пам'яті (на час інстансу).
type Campaign = {
  id: string;
  createdAt: string;           // ISO
  fromPipelineId: string;
  fromStatusId: string;
  toPipelineId: string;
  toStatusId: string;
  expiresDays?: number | null; // Напр., 7
  title?: string;              // опціонально
};

// -------- helpers for KV (Upstash REST) ----------
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
async function kvGet(key: string) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({} as any));
  return j?.result ?? null;
}
async function kvSet(key: string, value: unknown) {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
  return r.ok;
}
async function kvDel(key: string) {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return r.ok;
}
const IDS_KEY = 'cmp:ids';
async function getIds(): Promise<string[]> {
  const raw = await kvGet(IDS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function setIds(ids: string[]) { await kvSet(IDS_KEY, ids); }
async function getOne(id: string): Promise<Campaign|null> {
  const raw = await kvGet(`cmp:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function setOne(id: string, obj: Campaign) { await kvSet(`cmp:${id}`, obj); }
async function delOne(id: string) { await kvDel(`cmp:${id}`); }

// ---- in-memory fallback (на випадок відсутності KV) ----
const G: any = globalThis as any;
G.__CMP_IDS__ ??= [] as string[];
G.__CMP_MAP__ ??= new Map<string, Campaign>();

export async function GET() {
  if (KV_URL && KV_TOKEN) {
    const ids = await getIds();
    const items = await Promise.all(ids.map((id) => getOne(id)));
    return Response.json({ items: items.filter(Boolean) });
  }
  const items = G.__CMP_IDS__.map((id: string) => G.__CMP_MAP__.get(id)).filter(Boolean);
  return Response.json({ items });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const obj: Campaign = {
    id,
    createdAt: new Date().toISOString(),
    fromPipelineId: String(body.fromPipelineId || ''),
    fromStatusId:   String(body.fromStatusId   || ''),
    toPipelineId:   String(body.toPipelineId   || ''),
    toStatusId:     String(body.toStatusId     || ''),
    expiresDays:    body.expiresDays != null ? Number(body.expiresDays) : null,
    title:          body.title ? String(body.title) : undefined,
  };

  if (KV_URL && KV_TOKEN) {
    const ids = await getIds();
    await setOne(id, obj);
    await setIds([...new Set([...ids, id])]);
    return Response.json({ ok:true, item: obj });
  }
  // fallback
  if (!G.__CMP_IDS__.includes(id)) G.__CMP_IDS__.push(id);
  G.__CMP_MAP__.set(id, obj);
  return Response.json({ ok:true, item: obj });
}
