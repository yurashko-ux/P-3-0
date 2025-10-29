// web/app/api/keycrm/paginate-check/route.ts
import { NextResponse } from "next/server";
import { baseUrl, ensureBearer } from "../_common";

export const dynamic = "force-dynamic";

const BASE = baseUrl();
const TOKEN = ensureBearer(
  process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_TOKEN ||
    ""
);

function headers() {
  return TOKEN
    ? { Authorization: TOKEN, Accept: "application/json" }
    : { Accept: "application/json" };
}

async function kcGet(path: string) {
  if (!TOKEN) return { ok: false, status: 401, json: { error: "KEYCRM token missing" }, url: BASE + path };
  const url = `${BASE}${path}`;
  const r = await fetch(url, { headers: headers(), cache: "no-store" }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: { error: "fetch failed" }, url };
  let json: any = null; try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json, url };
}

function extractContainer(j: any) {
  if (Array.isArray(j)) return { container: "root[]", items: j };
  if (Array.isArray(j?.data)) return { container: "data[]", items: j.data };
  if (Array.isArray(j?.items)) return { container: "items[]", items: j.items };
  if (Array.isArray(j?.result)) return { container: "result[]", items: j.result };
  if (Array.isArray(j?.data?.items)) return { container: "data.items[]", items: j.data.items };
  return { container: "unknown", items: [] as any[] };
}

function extractMeta(j: any) {
  const m = j?.meta || {};
  return {
    raw: m,
    detected: {
      total: m.total ?? m.total_items ?? null,
      per_page: m.per_page ?? m.page_size ?? null,
      current_page: m.current_page ?? m.page?.current ?? null,
      last_page: m.last_page ?? (m.total && (m.per_page || m.page_size) ? Math.ceil(m.total / (m.per_page || m.page_size)) : null),
    },
    links: j?.links || null,
  };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const search = (u.searchParams.get("search") || "").trim();
  const pipeline_id = (u.searchParams.get("pipeline_id") || "").trim();
  const page = Number(u.searchParams.get("page") || "1");
  const size = Number(u.searchParams.get("size") || "5");

  const q: string[] = [];
  if (search) q.push(`search=${encodeURIComponent(search)}`);
  if (pipeline_id) q.push(`pipeline_id=${encodeURIComponent(pipeline_id)}`);

  // JSON:API стиль
  const qJsonApi = [`page[number]=${page}`, `page[size]=${size}`, ...q].join("&");
  const r1 = await kcGet(`/pipelines/cards?${qJsonApi}`);
  const c1 = extractContainer(r1.json);
  const m1 = extractMeta(r1.json);

  // Laravel стиль
  const qLaravel = [`page=${page}`, `per_page=${size}`, ...q].join("&");
  const r2 = await kcGet(`/pipelines/cards?${qLaravel}`);
  const c2 = extractContainer(r2.json);
  const m2 = extractMeta(r2.json);

  return NextResponse.json({
    ok: true,
    base_url: BASE,
    params_used: { search: search || null, pipeline_id: pipeline_id || null, page, size },
    jsonapi: {
      url: r1.url,
      status: r1.status,
      ok: r1.ok,
      container: c1.container,
      count: c1.items.length,
      sample_keys: c1.items[0] ? Object.keys(c1.items[0]) : [],
      meta: m1.detected,
      meta_raw_exists: !!m1.raw,
    },
    laravel: {
      url: r2.url,
      status: r2.status,
      ok: r2.ok,
      container: c2.container,
      count: c2.items.length,
      sample_keys: c2.items[0] ? Object.keys(c2.items[0]) : [],
      meta: m2.detected,
      meta_raw_exists: !!m2.raw,
    },
    hint: "Дивись який варіант (jsonapi/laravel) повертає ok:true та ненульовий count. Також зверни увагу на структуру meta.* — ці ключі ми використаємо для пагінації в пошуку.",
  });
}
