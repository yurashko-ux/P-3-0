// web/app/api/keycrm/statuses/route.ts
import { NextRequest, NextResponse } from "next/server";

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;
async function kvGet(key: string) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}
async function kvSet(key: string, value: any, ttlSec = 600) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ value: JSON.stringify(value), expiration: ttlSec }),
  }).catch(() => {});
}

function arr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    for (const k of ["items", "data", "result", "rows", "list"]) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}
function toStatuses(a: any[]): { id: string; pipeline_id: string; title: string }[] {
  const out: { id: string; pipeline_id: string; title: string }[] = [];
  for (const s of a) {
    const id = s?.id ?? s?.value ?? s?.key ?? s?.uuid;
    const pipeline_id = s?.pipeline_id ?? s?.pipelineId ?? s?.pipeline ?? "";
    const title = s?.title ?? s?.name ?? s?.label ?? (id != null ? `#${id}` : "");
    if (id != null) out.push({ id: String(id), pipeline_id: String(pipeline_id), title: String(title) });
  }
  const uniq = new Map(out.map((i) => [i.id, i]));
  return [...uniq.values()];
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filterPid = url.searchParams.get("pipeline_id") || undefined;

  const CACHE_KEY = "keycrm:statuses";
  const KEYCRM_URL = (process.env.KEYCRM_API_URL || "").replace(/\/+$/, "");
  const BEARER = process.env.KEYCRM_BEARER || "";

  // 1) кеш
  let cachedItems: { id: string; pipeline_id: string; title: string }[] | null = null;
  const cached = await kvGet(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) cachedItems = parsed;
    } catch {}
  }

  // 2) проксі KeyCRM
  if (KEYCRM_URL && BEARER) {
    try {
      const r = await fetch(`${KEYCRM_URL}/statuses`, {
        headers: { Authorization: `Bearer ${BEARER}` },
        cache: "no-store",
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const items = toStatuses(arr(j));
        if (items.length) {
          await kvSet(CACHE_KEY, items, 600).catch(() => {});
          return NextResponse.json(filterPid ? items.filter((s) => s.pipeline_id === filterPid) : items);
        }
      }
    } catch {
      // ignore
    }
  }

  // 3) fallback cache
  const items = cachedItems ?? [];
  return NextResponse.json(filterPid ? items.filter((s) => s.pipeline_id === filterPid) : items);
}
