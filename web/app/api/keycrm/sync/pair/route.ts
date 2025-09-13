// web/app/api/keycrm/sync/pair/route.ts
import { NextResponse } from "next/server";
import { kvSet, kvZAdd } from "@/lib/kv";

export const dynamic = "force-dynamic";

/**
 * POST /api/keycrm/sync/pair?pipeline_id=1&status_id=38&per_page=50&max_pages=3
 * Auth:
 *  - Header: Authorization: Bearer <ADMIN_PASS>
 *  - або ?admin=<ADMIN_PASS>
 *
 * ENV:
 *  - KEYCRM_API_TOKEN (required)
 *  - KEYCRM_BASE_URL (default: https://openapi.keycrm.app/v1)
 *  - ADMIN_PASS (guard)
 *
 * KV записи:
 *  - kc:card:{id} => JSON string (нормалізована картка)
 *  - kc:index:cards:{pipeline_id}:{status_id} => ZSET(score=updated_at_epoch, member=card_id)
 */
export async function POST(req: Request) {
  // ----- admin guard
  const url = new URL(req.url);
  const adminFromQuery = url.searchParams.get("admin") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  const ADMIN_PASS = process.env.ADMIN_PASS ?? "";
  if (!ADMIN_PASS || (adminFromQuery !== ADMIN_PASS && bearer !== ADMIN_PASS)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ----- params
  const pipeline_id = url.searchParams.get("pipeline_id");
  const status_id = url.searchParams.get("status_id");
  const per_page = Number(url.searchParams.get("per_page") ?? 50);
  const max_pages = Number(url.searchParams.get("max_pages") ?? 3);

  if (!pipeline_id || !status_id) {
    return NextResponse.json(
      { ok: false, error: "pipeline_id and status_id are required" },
      { status: 400 }
    );
  }

  const KEYCRM_BASE_URL =
    (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
  const KEYCRM_API_TOKEN = process.env.KEYCRM_API_TOKEN;
  if (!KEYCRM_API_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Missing KEYCRM_API_TOKEN env" },
      { status: 500 }
    );
  }

  // ----- iterate pages
  let page = 1;
  let last_page = Infinity;
  let seen = 0;
  const indexKey = `kc:index:cards:${pipeline_id}:${status_id}`;

  while (page <= max_pages && page <= last_page) {
    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(per_page),
      pipeline_id: String(pipeline_id),
      status_id: String(status_id),
    });
    const kcUrl = `${KEYCRM_BASE_URL}/pipelines/cards?${qs.toString()}`;

    const res = await fetch(kcUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${KEYCRM_API_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, error: json?.message || json || "KeyCRM request failed" },
        { status: res.status }
      );
    }

    // Laravel-style pagination (current_page/last_page/data[])
    last_page = Number(json?.last_page ?? json?.meta?.last_page ?? page);
    const data: any[] = Array.isArray(json?.data) ? json.data : [];

    for (const raw of data) {
      const card = normalizeCard(raw);
      const score = toEpoch(card.updated_at);

      // IMPORTANT: KV очікує string → зберігаємо JSON.stringify(...)
      await kvSet(`kc:card:${card.id}`, JSON.stringify(card));
      await kvZAdd(indexKey, score, String(card.id));
      seen++;
    }

    if (page >= last_page) break;
    page++;
  }

  return NextResponse.json({
    ok: true,
    pair: { pipeline_id, status_id },
    per_page,
    max_pages,
    pages_fetched: Math.min(max_pages, last_page),
    cards_processed: seen,
  });
}

// ---- helpers

function normalizeCard(raw: any) {
  const pipelineId =
    numOrNull(raw?.pipeline_id) ?? numOrNull(raw?.status?.pipeline_id) ?? null;
  const statusId = numOrNull(raw?.status_id) ?? numOrNull(raw?.status?.id) ?? null;

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? "").trim(),
    pipeline_id: pipelineId,
    status_id: statusId,
    contact_social_name: (raw?.contact?.social_name ?? null)?.toString().toLowerCase() ?? null,
    contact_social_id: raw?.contact?.social_id ?? null,
    contact_full_name:
      raw?.contact?.full_name ??
      raw?.contact?.client?.full_name ??
      null,
    updated_at:
      raw?.updated_at ??
      raw?.status_changed_at ??
      new Date().toISOString(),
  } as const;
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toEpoch(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}
