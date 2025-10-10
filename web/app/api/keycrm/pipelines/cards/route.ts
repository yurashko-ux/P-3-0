// web/app/api/keycrm/pipelines/cards/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = process.env.KEYCRM_BASE_URL ?? "https://openapi.keycrm.app/v1";
const TOKEN = process.env.KEYCRM_API_TOKEN;
const ADMIN_PASS = process.env.ADMIN_PASS;

function isAuthed(req: Request) {
  if (!ADMIN_PASS) return true; // якщо не задано — не блокуємо (тільки для тесту)
  const u = new URL(req.url);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const qs = u.searchParams.get("admin") || u.searchParams.get("token");
  const hdr = req.headers.get("x-admin-pass");
  return bearer === ADMIN_PASS || qs === ADMIN_PASS || hdr === ADMIN_PASS;
}

export async function GET(req: Request) {
  try {
    if (!TOKEN) {
      return NextResponse.json(
        { ok: false, error: "Missing KEYCRM_API_TOKEN env" },
        { status: 500 }
      );
    }
    if (!isAuthed(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const u = new URL(req.url);
    const q = u.searchParams;

    const pipelineId =
      q.get("pipeline_id") ?? q.get("pipelineId") ?? q.get("id") ?? undefined;

    const upstream = new URL(
      pipelineId ? `${BASE}/pipelines/${encodeURIComponent(pipelineId)}/cards` : `${BASE}/pipelines/cards`
    );

    const pageNumber =
      q.get("page[number]") ??
      q.get("page") ??
      q.get("pageNumber") ??
      undefined;
    const pageSize =
      q.get("page[size]") ??
      q.get("per_page") ??
      q.get("pageSize") ??
      undefined;

    upstream.searchParams.set("page[number]", pageNumber ?? "1");
    upstream.searchParams.set("page[size]", pageSize ?? "50");

    const statusFilter =
      q.get("filter[status_id]") ??
      q.get("status_id") ??
      q.get("statusId") ??
      undefined;
    if (statusFilter) {
      upstream.searchParams.set("filter[status_id]", statusFilter);
    }

    const pipelineFilter =
      q.get("filter[pipeline_id]") ??
      (!pipelineId ? q.get("pipeline_id") : null);
    if (pipelineFilter) {
      upstream.searchParams.set("filter[pipeline_id]", pipelineFilter);
    }

    const includeValues = q.getAll("include[]");
    const withValues = q.getAll("with[]");
    const relations = includeValues.length > 0 ? includeValues : ["contact", "contact.client", "client", "client.profiles"];
    for (const relation of relations) {
      upstream.searchParams.append("include[]", relation);
    }
    for (const relation of (withValues.length > 0 ? withValues : relations)) {
      upstream.searchParams.append("with[]", relation);
    }

    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      { ok: res.ok, status: res.status, url: upstream.toString(), data },
      { status: res.ok ? 200 : res.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 500 }
    );
  }
}
