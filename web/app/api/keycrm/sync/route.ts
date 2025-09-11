// web/app/api/keycrm/sync/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

const ADMIN = process.env.ADMIN_PASS ?? "";
const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

/** --- auth: admin cookie or Bearer --- */
function okAuth(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const cookiePass = cookies().get("admin_pass")?.value || "";
  const pass = token || cookiePass;
  return !ADMIN || pass === ADMIN;
}

/** --- http helpers for KeyCRM --- */
function kcUrl(path: string, qp?: Record<string, any>) {
  const url = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(qp || {})) url.searchParams.set(k, String(v));
  return url.toString();
}
async function kcGet(path: string, qp?: Record<string, any>) {
  const url = kcUrl(path, qp);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json, url };
}

/** --- time/normalize --- */
function parseUpdatedAt(s: any): number {
  if (!s) return Date.now();
  const str = String(s);
  // підтримка "YYYY-MM-DD HH:mm:ss" і ISO:
  const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str) ? str.replace(" ", "T") + "Z" : str;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}
const norm = (s?: string) => (s || "").trim();
const low = (s?: string) => norm(s).toLowerCase();
const stripAt = (s: string) => s.replace(/^@+/, "");

/** --- read all enabled campaigns and dedupe base pipeline/status pairs --- */
async function readCampaignPairs() {
  const ids = await kvZRange("campaigns:index", 0, -1);
  const pairs = new Map<string, { pipeline_id: number; status_id: number; campaign_id: string; campaign_name: string }>();
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      const c = JSON.parse(raw);
      if (!c.enabled) continue;
      const p = Number(c.base_pipeline_id);
      const s = Number(c.base_status_id);
      if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
      const key = `${p}:${s}`;
      if (!pairs.has(key)) {
        pairs.set(key, { pipeline_id: p, status_id: s, campaign_id: c.id, campaign_name: c.name || "" });
      }
    } catch {}
  }
  return Array.from(pairs.values());
}

/** --- persist to KV indexes ---
 *  kc:card:{id} -> JSON (minimal)
 *  kc:index:cards:{pipeline}:{status} -> ZSET score=updated_at member=card_id
 *  kc:index:social:{social_name}:{handle} -> ZSET score=updated_at member=card_id  (і з @, і без @)
 */
async function indexCard(c: any) {
  const id = c?.id;
  if (!id) return false;
  const updatedAt = parseUpdatedAt(c?.updated_at || c?.status_changed_at);
  const card = {
    id,
    title: c?.title ?? null,
    pipeline_id: c?.pipeline_id ?? null,
    status_id: c?.status_id ?? null,
    contact_social_name: c?.contact?.social_name ?? null,
    contact_social_id: c?.contact?.social_id ?? null,
    updated_at: c?.updated_at ?? null,
  };
  await kvSet(`kc:card:${id}`, JSON.stringify(card));
  if (card.pipeline_id && card.status_id) {
    await kvZAdd(`kc:index:cards:${card.pipeline_id}:${card.status_id}`, updatedAt, String(id));
  }
  const socialName = low(card.contact_social_name || "");
  const socialIdRaw = norm(card.contact_social_id || "");
  if (socialName && socialIdRaw) {
    const noAt = stripAt(socialIdRaw);
    // індексуємо дві форми — з @ та без @
    await kvZAdd(`kc:index:social:${socialName}:${noAt}`, updatedAt, String(id));
    await kvZAdd(`kc:index:social:${socialName}:${socialIdRaw}`, updatedAt, String(id));
  }
  return true;
}

/** --- main sync: only base pipeline/status for enabled campaigns --- */
export async function POST(req: Request) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!TOKEN) {
    return NextResponse.json({ ok: false, error: "keycrm_not_configured", need: { KEYCRM_API_TOKEN: true } }, { status: 200 });
  }

  // query overrides
  const url = new URL(req.url);
  const maxPages = Math.max(1, Math.min(20, Number(url.searchParams.get("max_pages") || 5)));
  const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("per_page") || 50)));

  const pairs = await readCampaignPairs();
  if (!pairs.length) {
    return NextResponse.json({ ok: true, message: "no_active_campaigns" }, { status: 200 });
  }

  const summary: any[] = [];
  for (const pair of pairs) {
    let saved = 0;
    let checked = 0;
    let pages = 0;

    // пагінація: спочатку laravel-стиль, інакше jsonapi
    for (let page = 1; page <= maxPages; page++) {
      pages = page;
      // laravel style
      let resp = await kcGet("/pipelines/cards", { page, per_page: perPage });
      if (!resp.ok || !Array.isArray(resp.json?.data)) {
        // jsonapi fallback
        resp = await kcGet("/pipelines/cards", { "page[number]": page, "page[size]": perPage });
      }
      const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
      if (!rows.length) break;

      // фільтруємо саме базову воронку+статус
      const filtered = rows.filter(
        (r) => r?.pipeline_id === pair.pipeline_id && r?.status_id === pair.status_id
      );

      for (const r of filtered) {
        checked++;
        const ok = await indexCard(r);
        if (ok) saved++;
      }

      // якщо на сторінці не було жодного кандидата, і так 2 рази поспіль — рано виходимо
      if (filtered.length === 0 && page >= 2) break;
    }

    summary.push({
      pipeline_id: pair.pipeline_id,
      status_id: pair.status_id,
      campaign_id: pair.campaign_id,
      campaign_name: pair.campaign_name,
      checked,
      saved,
      pages_scanned: pages,
    });
  }

  return NextResponse.json({ ok: true, pairs: pairs.length, summary }, { status: 200 });
}
