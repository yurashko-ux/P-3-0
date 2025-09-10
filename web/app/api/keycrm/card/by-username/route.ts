// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic";

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

const norm = (s: string) => (s || "").trim().replace(/^@+/, "").toLowerCase();

async function kcGet(path: string) {
  if (!TOKEN) return { ok: false, status: 401, json: null };
  const url = path.startsWith("http") ? path : `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: null };
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json };
}

function extractItems(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  return [];
}

function getMeta(j: any) {
  const m = j?.meta || {};
  const total = m.total ?? m.total_items ?? undefined;
  const perPage = m.per_page ?? m.page_size ?? undefined;
  const current = m.current_page ?? m.page?.current ?? undefined;
  const last = m.last_page ?? (total && perPage ? Math.ceil(total / perPage) : undefined);
  return { total, perPage, current, last };
}

async function getCardDetailSocial(cardId: string): Promise<string> {
  const r = await kcGet(`/pipelines/cards/${encodeURIComponent(cardId)}`);
  if (!r.ok) return "";
  const d = r.json?.data ?? r.json ?? null;
  const social = d?.contact?.social_id ?? "";
  return norm(String(social || ""));
}

async function tryList(pathBase: string, style: "jsonapi" | "laravel", pageLimit: number, detailLimit: number, target: string) {
  let checked = 0;
  for (let page = 1; page <= pageLimit; page++) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const path =
      style === "jsonapi"
        ? `${pathBase}${sep}page[number]=${page}&page[size]=100`
        : `${pathBase}${sep}page=${page}&per_page=100`;

    const r = await kcGet(path);
    if (!r.ok) break;

    const items = extractItems(r.json);
    if (!items.length) break;

    // 1) якщо у списку вже є contact.social_id — перевіряємо миттєво
    for (const it of items) {
      const id = String(it?.id ?? it?.card_id ?? "");
      const listedSocial = norm(String(it?.contact?.social_id ?? ""));
      if (id && listedSocial && listedSocial === target) {
        return { id, checked };
      }
    }

    // 2) інакше — перевіряємо деталі кандидатів (обмежено detailLimit)
    for (const it of items) {
      if (checked >= detailLimit) break;
      const id = String(it?.id ?? it?.card_id ?? "");
      if (!id) continue;
      const social = await getCardDetailSocial(id);
      checked++;
      if (social && social === target) {
        return { id, checked };
      }
    }

    const meta = getMeta(r.json);
    if (meta.last && meta.current && meta.current >= meta.last) break;
    if (checked >= detailLimit) break;
  }
  return { id: null as string | null, checked };
}

/**
 * Пошук картки за contact.social_id:
 * - спочатку KV-кеш map:ig:<username> (щоб не сканувати щоразу)
 * - далі скан сторінок у межах воронки (якщо задано pipeline_id)
 * - якщо не знайдено — скан усього списку карток (обмеження по сторінках/деталях)
 */
async function findBySocialId(username: string, pipelineId?: string) {
  const target = norm(username);
  if (!target) return { id: null as string | null, via: "empty-username", checked: 0 };

  // 0) KV cache
  const cacheKey = pipelineId
    ? `map:ig:${target}:p:${pipelineId}`
    : `map:ig:${target}`;
  const cached = await kvGet(cacheKey);
  if (cached) {
    try {
      const j = JSON.parse(cached);
      if (j?.card_id) return { id: String(j.card_id), via: "kv-cache", checked: 0 };
    } catch {}
  }

  // 1) спроба в межах воронки (точково й швидко)
  if (pipelineId) {
    const base1 = `/pipelines/cards?pipeline_id=${encodeURIComponent(pipelineId)}`;
    // скорочені ліміти (спершу — швидка спроба)
    let r1 = await tryList(base1, "jsonapi", 5, 150, target);
    if (!r1.id) r1 = await tryList(base1, "laravel", 5, 150, target);
    if (r1.id) {
      await kvSet(cacheKey, JSON.stringify({ card_id: r1.id, found_at: Date.now(), scope: "pipeline" }));
      return { id: r1.id, via: "pipeline-scan", checked: r1.checked };
    }
  }

  // 2) глобальний скан (обмежено)
  const baseAll = `/pipelines/cards`;
  // трохи більші ліміти, але в рамках розумного таймаута
  let r2 = await tryList(`${baseAll}`, "jsonapi", 15, 400, target);
  if (!r2.id) r2 = await tryList(`${baseAll}`, "laravel", 15, 400, target);
  if (r2.id) {
    await kvSet(cacheKey, JSON.stringify({ card_id: r2.id, found_at: Date.now(), scope: "global" }));
    return { id: r2.id, via: "global-scan", checked: r2.checked };
  }

  return { id: null as string | null, via: "not-found", checked: 0 };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") || "").trim();
  const pipelineId = (searchParams.get("pipeline_id") || "").trim();

  if (!username) {
    return NextResponse.json({ ok: false, error: "username required" }, { status: 400 });
  }

  const found = await findBySocialId(username, pipelineId || undefined);
  return NextResponse.json({
    ok: !!found.id,
    username,
    card_id: found.id,
    strategy: found.via,
    checked: found.checked,
    scope: pipelineId ? "pipeline" : "global",
  });
}
