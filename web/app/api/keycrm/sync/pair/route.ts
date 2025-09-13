// web/app/api/keycrm/sync/pair/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd, kvZRange, kvZRem } from "@/lib/kv";
import { kcListCardsLaravel } from "@/lib/keycrm";

export const dynamic = "force-dynamic";

type AnyObj = Record<string, any>;

interface Card {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: any;
  contact_full_name: any;
  updated_at: string;
}

function toEpoch(d: any): number {
  const t = typeof d === "string" ? Date.parse(d) : Number(d);
  return Number.isFinite(t) ? t : Date.now();
}

function normalizeCard(raw: AnyObj): Card {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;

  const socialName = String(raw?.contact?.social_name ?? "")
    .trim()
    .toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;

  const fullName =
    raw?.contact?.full_name ??
    raw?.contact?.client?.full_name ??
    null;

  const updated =
    raw?.updated_at ??
    raw?.status_changed_at ??
    new Date().toISOString();

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? "").trim(),
    pipeline_id: pipelineId ? Number(pipelineId) : null,
    status_id: statusId ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName,
    updated_at: String(updated),
  };
}

async function listActiveBasePairs(): Promise<Array<{ p: string; s: string }>> {
  const ids: string[] = (await kvZRange("campaigns:index", 0, -1)) ?? [];
  const pairs: Array<{ p: string; s: string }> = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const c = (await kvGet(`campaigns:${id}`)) as AnyObj | null;
    if (!c) continue;

    const active =
      c.active !== false &&
      c.enabled !== false &&
      c.disabled !== true &&
      c.archived !== true;

    const p = c.base_pipeline_id ?? c.pipeline_id ?? c.pipeline ?? null;
    const s = c.base_status_id ?? c.status_id ?? c.status ?? null;

    if (!active || p == null || s == null) continue;

    const key = `${p}:${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ p: String(p), s: String(s) });
  }
  return pairs;
}

async function resetPairIndex(p: string, s: string) {
  const cardsKey = `kc:index:cards:${p}:${s}`;
  const members: string[] = (await kvZRange(cardsKey, 0, -1)) ?? [];
  for (const m of members) {
    await kvZRem(cardsKey, m);
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const admin =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("admin") ||
    req.headers.get("x-admin-pass");

  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (!ADMIN_PASS || admin !== ADMIN_PASS) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const per_page = Number(url.searchParams.get("per_page") ?? 50);
  const max_pages = Number(url.searchParams.get("max_pages") ?? 3);
  const force = url.searchParams.get("force") === "1";

  const pairs = await listActiveBasePairs();
  const results: AnyObj[] = [];

  for (const { p, s } of pairs) {
    const cardsKey = `kc:index:cards:${p}:${s}`;
    if (force) {
      await resetPairIndex(p, s);
    }

    let page = 1;
    let lastPage = Number.POSITIVE_INFINITY;
    let seen = 0;
    let updatedMax = 0;

    while (page <= max_pages && page <= lastPage) {
      const resp: AnyObj = await kcListCardsLaravel({
        pipeline_id: p,
        status_id: s,
        page,
        per_page,
      });

      const data: AnyObj[] =
        resp?.data ?? resp?.items ?? resp?.results ?? [];
      lastPage =
        resp?.last_page ??
        resp?.meta?.last_page ??
        resp?.pagination?.last_page ??
        page;

      for (const raw of data) {
        const card = normalizeCard(raw);
        const score = toEpoch(card.updated_at);
        if (score > updatedMax) updatedMax = score;

        // 1) повний об’єкт картки — зберігаємо як JSON-рядок
        await kvSet(`kc:card:${card.id}`, JSON.stringify(card));

        // 2) індекс карток у базовій парі
        await kvZAdd(cardsKey, score, String(card.id));

        // 3) IG-індекс (і без @, і з @)
        if (
          card.contact_social_name === "instagram" &&
          card.contact_social_id
        ) {
          const handle = String(card.contact_social_id)
            .trim()
            .replace(/^@/, "")
            .toLowerCase();
          await kvZAdd(
            `kc:index:social:instagram:${handle}`,
            score,
            String(card.id)
          );
          await kvZAdd(
            `kc:index:social:instagram:@${handle}`,
            score,
            String(card.id)
          );
        }

        seen++;
      }

      page++;
    }

    if (updatedMax) {
      await kvSet(`kc:sync:last_updated:${p}:${s}`, String(updatedMax));
    }

    results.push({
      base_pair: { pipeline_id: p, status_id: s },
      pages_fetched: Math.min(max_pages, lastPage),
      cards_seen: seen,
      last_updated_epoch: updatedMax || null,
    });
  }

  return NextResponse.json({ ok: true, pairs: pairs.length, results }, { status: 200 });
}
