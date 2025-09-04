type Ctx = { params: { id: string } };

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key: string) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: 'no-store'
  });
  const j = await r.json().catch(() => ({} as any));
  return j?.result ?? null;
}
async function kvSet(key: string, value: unknown) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'content-type':'application/json' },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
  return r.ok;
}
async function kvDel(key: string) {
  const r = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return r.ok;
}
async function getIds(): Promise<string[]> {
  const raw = await kvGet('cmp:ids'); if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function setIds(ids: string[]) { await kvSet('cmp:ids', ids); }

const G: any = globalThis as any;
G.__CMP_IDS__ ??= [] as string[];
G.__CMP_MAP__ ??= new Map<string, any>();

export async function GET(_req: Request, { params: { id }}: Ctx) {
  if (KV_URL && KV_TOKEN) {
    const raw = await kvGet(`cmp:${id}`);
    if (!raw) return new Response('Not found', { status:404 });
    return Response.json(JSON.parse(raw));
  }
  const item = G.__CMP_MAP__.get(id);
  if (!item) return new Response('Not found', { status:404 });
  return Response.json(item);
}

export async function PUT(req: Request, { params: { id }}: Ctx) {
  const patch = await req.json().catch(() => ({}));
  if (KV_URL && KV_TOKEN) {
    const raw = await kvGet(`cmp:${id}`);
    if (!raw) return new Response('Not found', { status:404 });
    const next = { ...JSON.parse(raw), ...patch };
    await kvSet(`cmp:${id}`, next);
    return Response.json({ ok:true, item: next });
  }
  const cur = G.__CMP_MAP__.get(id);
  if (!cur) return new Response('Not found', { status:404 });
  const next = { ...cur, ...patch };
  G.__CMP_MAP__.set(id, next);
  return Response.json({ ok:true, item: next });
}

export async function DELETE(_req: Request, { params: { id }}: Ctx) {
  if (KV_URL && KV_TOKEN) {
    await kvDel(`cmp:${id}`);
    const ids = await getIds();
    await setIds(ids.filter((x) => x !== id));
    return Response.json({ ok:true });
  }
  G.__CMP_MAP__.delete(id);
  G.__CMP_IDS__ = G.__CMP_IDS__.filter((x: string) => x !== id);
  return Response.json({ ok:true });
}
