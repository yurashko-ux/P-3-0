// web/app/api/keycrm/statuses/route.ts
import { NextRequest, NextResponse } from "next/server";

/** ---------- KV (Upstash/Vercel) helpers ---------- */
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

async function kvGetStr(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null as any);
    return (j && typeof j.result === "string") ? j.result : null;
  } catch {
    return null;
  }
}
async function kvSetJSON(key: string, value: any, ttlSec = 600) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: JSON.stringify(value), expiration: ttlSec }),
    });
  } catch {}
}

/** ---------- Robust array extraction ---------- */
function firstArrayDeep(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    // breadth-first search up to a few levels
    const q: any[] = [x];
    const seen = new Set<any>([x]);
    while (q.length) {
      const cur = q.shift()!;
      for (const v of Object.values(cur)) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === "object" && !seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
  }
  return [];
}

/** ---------- Normalizers ---------- */
type StatusItem = { id: string; pipeline_id: string; title: string };

function normalizeStatuses(arr: any[], ctxPipelineId?: string): StatusItem[] {
  const out: StatusItem[] = [];
  for (const s of arr) {
    const id = s?.id ?? s?.status_id ?? s?.value ?? s?.key ?? s?.uuid;
    const pipeline_id =
      s?.pipeline_id ?? s?.pipelineId ?? s?.pipeline ?? ctxPipelineId ?? "";
    const title =
      s?.title ?? s?.name ?? s?.label ?? (id != null ? `#${id}` : "");
    if (id != null) {
      out.push({
        id: String(id),
        pipeline_id: String(pipeline_id ?? ""),
        title: String(title),
      });
    }
  }
  // de-dup by id
  const uniq = new Map(out.map((i) => [i.id, i]));
  return [...uniq.values()];
}

/** ---------- KeyCRM fetch helpers ---------- */
const BASE = (process.env.KEYCRM_API_URL || "").replace(/\/+$/, "");
const BEARER = process.env.KEYCRM_BEARER || "";

async function fetchJSON(url: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}
async function tryStatusesGlobal(): Promise<StatusItem[]> {
  if (!BASE || !BEARER) return [];
  const j = await fetchJSON(`${BASE}/statuses`);
  return normalizeStatuses(firstArrayDeep(j));
}
async function tryStatusesByPipeline(pid: string): Promise<StatusItem[]> {
  if (!BASE || !BEARER) return [];
  // варіант 1: глобальний ендпоінт з query
  const j1 = await fetchJSON(`${BASE}/statuses?pipeline_id=${encodeURIComponent(pid)}`);
  const a1 = normalizeStatuses(firstArrayDeep(j1));
  if (a1.length) return a1.map((s) => ({ ...s, pipeline_id: s.pipeline_id || pid }));

  // варіант 2: вкладений ендпоінт
  const j2 = await fetchJSON(`${BASE}/pipelines/${encodeURIComponent(pid)}/statuses`);
  const a2 = normalizeStatuses(firstArrayDeep(j2), pid);
  return a2;
}
async function tryAllPipelines(): Promise<{ id: string; title: string }[]> {
  if (!BASE || !BEARER) return [];
  const j = await fetchJSON(`${BASE}/pipelines`);
  const arr = firstArrayDeep(j);
  const out: { id: string; title: string }[] = [];
  for (const p of arr) {
    const id = p?.id ?? p?.value ?? p?.key ?? p?.uuid;
    const title = p?.title ?? p?.name ?? p?.label ?? (id != null ? `#${id}` : "");
    if (id != null) out.push({ id: String(id), title: String(title) });
  }
  const uniq = new Map(out.map((i) => [i.id, i]));
  return [...uniq.values()];
}

/** ---------- Route ---------- */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filterPid = url.searchParams.get("pipeline_id") || undefined;

  const CACHE_KEY = "keycrm:statuses";

  // 1) якщо є pipeline_id — спробувати напряму по цьому pid
  if (filterPid) {
    const items = await tryStatusesByPipeline(filterPid);
    if (items.length) return NextResponse.json(items, { status: 200 });

    // fallback: з кешу
    const cachedStr = await kvGetStr(CACHE_KEY);
    if (cachedStr) {
      try {
        const cached = JSON.parse(cachedStr) as StatusItem[];
        return NextResponse.json(cached.filter((s) => s.pipeline_id === String(filterPid)));
      } catch {}
    }
    return NextResponse.json([], { status: 200 });
  }

  // 2) без фільтра — спробуємо глобально
  let all: StatusItem[] = await tryStatusesGlobal();

  // 3) якщо глобально не віддало — пройдемося по всіх воронках
  if (!all.length) {
    const pipes = await tryAllPipelines();
    const collected: StatusItem[] = [];
    for (const p of pipes) {
      const arr = await tryStatusesByPipeline(p.id);
      for (const s of arr) collected.push({ ...s, pipeline_id: s.pipeline_id || p.id });
    }
    all = collected;
  }

  // 4) кешуємо та віддаємо
  if (all.length) await kvSetJSON(CACHE_KEY, all, 600).catch(() => {});
  else {
    // fallback із кешу, якщо є
    const cachedStr = await kvGetStr(CACHE_KEY);
    if (cachedStr) {
      try {
        const cached = JSON.parse(cachedStr) as StatusItem[];
        return NextResponse.json(cached);
      } catch {}
    }
  }
  return NextResponse.json(all);
}
