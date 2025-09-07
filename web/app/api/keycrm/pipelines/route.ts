// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";

// --- minimal KV REST helper (без імпортів) ---
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

// --- normalize util ---
function arr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    for (const k of ["items", "data", "result", "rows", "list"]) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}
function toPipelines(a: any[]): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const p of a) {
    const id = p?.id ?? p?.value ?? p?.key ?? p?.uuid;
    const title = p?.title ?? p?.name ?? p?.label ?? (id != null ? `#${id}` : "");
    if (id != null) out.push({ id: String(id), title: String(title) });
  }
  // de-dup
  const uniq = new Map(out.map((i) => [i.id, i]));
  return [...uniq.values()];
}

export async function GET() {
  const CACHE_KEY = "keycrm:pipelines";
  const KEYCRM_URL = (process.env.KEYCRM_API_URL || "").replace(/\/+$/, "");
  const BEARER = process.env.KEYCRM_BEARER || "";

  // 1) пробуємо взяти свіжий кеш
  const cached = await kvGet(CACHE_KEY).catch(() => null);
  let fromCache: { id: string; title: string }[] | null = null;
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) fromCache = parsed;
    } catch {}
  }

  // 2) пробуємо проксувати в KeyCRM
  if (KEYCRM_URL && BEARER) {
    try {
      const r = await fetch(`${KEYCRM_URL}/pipelines`, {
        headers: { Authorization: `Bearer ${BEARER}` },
        cache: "no-store",
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const items = toPipelines(arr(j));
        if (items.length) {
          // оновлюємо кеш на 10 хв
          await kvSet(CACHE_KEY, items, 600).catch(() => {});
          return NextResponse.json(items, { status: 200 });
        }
      }
    } catch {
      // ignore, використаємо кеш
    }
  }

  // 3) fallback: віддаємо кеш або порожній масив
  return NextResponse.json(fromCache ?? [], { status: 200 });
}
