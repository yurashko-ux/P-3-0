// web/app/api/keycrm/sync/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { kcListCardsLaravel } from "@/lib/keycrm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ───────────────────────── helpers ───────────────────────── */

type CampaignKV = {
  id: number | string;
  name?: string;
  active?: boolean;
  deleted?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
};

function parseKVJson<T = any>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

function toEpoch(x: string | number | Date | null | undefined): number {
  if (!x) return Date.now();
  if (typeof x === "number") return x;
  if (x instanceof Date) return x.getTime();
  const n = Date.parse(String(x));
  return Number.isFinite(n) ? n : Date.now();
}

type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string; // ISO або KeyCRM-формат
};

function normalizeCard(raw: any): NormalizedCard {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName =
    (raw?.contact?.social_name ? String(raw.contact.social_name).toLowerCase() : "") || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName =
    raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? "").trim(),
    pipeline_id: pipelineId != null ? Number(pipelineId) : null,
    status_id: statusId != null ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at:
      String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  };
}

async function listActiveBasePairs() {
  const ids = (await kvZRange("campaigns:index", 0, -1)) || [];
  const pairs: Array<{
    id: string | number;
    name?: string;
    p: string;
    s: string;
  }> = [];

  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = parseKVJson<CampaignKV>(raw);
    if (!c) continue;
    if (c.deleted) continue;
    if (!c.active) continue;
    const p = c.base_pipeline_id != null ? String(c.base_pipeline_id) : "";
    const s = c.base_status_id != null ? String(c.base_status_id) : "";
    if (!p || !s) continue;
    pairs.push({ id: c.id ?? id, name: c.name, p, s });
  }
  // унікалізуємо пари (p,s)
  const seen = new Set<string>();
  return pairs.filter(({ p, s }) => {
    const key = `${p}:${s}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ───────────────────────── handler ───────────────────────── */

export async function POST(req: Request) {
  await assertAdmin(req);

  const url = new URL(req.url);
  const per_page = Number(url.searchParams.get("per_page") ?? 50);
  const max_pages = Number(url.searchParams.get("max_pages") ?? 3);
  const force = url.searchParams.get("force") === "1"; // зарезервовано; очищення індексу можна додати окремо

  const basePairs = await listActiveBasePairs();
  const results: Array<{
    basePair: { pipeline_id: string; status_id: string };
    pagesFetched: number;
    cardsSeen: number;
    cardsIndexed: number;
  }> = [];

  for (const { p, s } of basePairs) {
    let page = 1;
    let lastPage = Infinity;
    let seen = 0;
    let indexed = 0;

    // TODO(optional): якщо force — почистити kc:index:cards:${p}:${s}
    // (в цьому коміті лише виправляємо типи/парсинг KV)

    while (page <= max_pages && page <= lastPage) {
      const resp: any = await kcListCardsLaravel({
        pipeline_id: p,
        status_id: s,
        page,
        per_page,
      });

      const data: any[] =
        resp?.data ??
        resp?.items ?? // на випадок різних форматів
        [];

      lastPage =
        Number(resp?.last_page ?? resp?.meta?.last_page ?? page) || page;

      for (const raw of data) {
        const card = normalizeCard(raw);
        const score = toEpoch(card.updated_at);

        // 1) повний об’єкт картки
        await kvSet(`kc:card:${card.id}`, card);

        // 2) індекс карток у базовій парі
        await kvZAdd(`kc:index:cards:${p}:${s}`, score, String(card.id));

        // 3) соц-індекси (тільки instagram, дублюємо без @ і з @)
        if (card.contact_social_name === "instagram" && card.contact_social_id) {
          const h = String(card.contact_social_id).replace(/^@/, "").toLowerCase();
          await kvZAdd(`kc:index:social:instagram:${h}`, score, String(card.id));
          await kvZAdd(`kc:index:social:instagram:@${h}`, score, String(card.id));
        }

        seen++;
        indexed++;
      }

      if (page >= lastPage) break;
      page++;
    }

    results.push({
      basePair: { pipeline_id: p, status_id: s },
      pagesFetched: Math.min(max_pages, lastPage),
      cardsSeen: seen,
      cardsIndexed: indexed,
    });
  }

  return NextResponse.json({
    ok: true,
    basePairs: basePairs.map(({ p, s }) => ({ pipeline_id: p, status_id: s })),
    results,
    forceApplied: force ?? false,
  });
}
