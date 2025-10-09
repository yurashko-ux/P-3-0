// web/app/api/keycrm/card/find/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  KeycrmCardSearchError,
  KeycrmCardSearchResult,
  searchKeycrmCardByIdentity,
} from "@/lib/keycrm-card-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isSearchError(
  result: KeycrmCardSearchResult | KeycrmCardSearchError
): result is KeycrmCardSearchError {
  return result.ok === false;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const needle =
    url.searchParams.get("needle") ||
    url.searchParams.get("q") ||
    url.searchParams.get("query") ||
    url.searchParams.get("value") ||
    "";

  if (!needle.trim()) {
    return NextResponse.json({ ok: false, error: "needle_required" }, { status: 400 });
  }

  const pipelineId = parseNumber(url.searchParams.get("pipeline_id"));
  const statusId = parseNumber(url.searchParams.get("status_id"));
  const perPage = parseNumber(url.searchParams.get("per_page"));
  const maxPages = parseNumber(url.searchParams.get("max_pages"));

  let result: KeycrmCardSearchResult | KeycrmCardSearchError;

  try {
    result = await searchKeycrmCardByIdentity({
      needle,
      pipelineId: pipelineId ?? undefined,
      statusId: statusId ?? undefined,
      perPage: perPage ?? undefined,
      maxPages: maxPages ?? undefined,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : err;
    return NextResponse.json(
      { ok: false, error: "keycrm_search_unhandled", details },
      { status: 500 }
    );
  }

  if (isSearchError(result)) {
    const status =
      result.error === "needle_required"
        ? 400
        : result.error === "keycrm_env_missing"
          ? 500
          : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
