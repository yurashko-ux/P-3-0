// web/app/api/keycrm/cards/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = (
  process.env.KEYCRM_API_URL ||
  process.env.KEYCRM_BASE_URL ||
  "https://openapi.keycrm.app/v1"
).replace(/\/+$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN ?? "";

// внутрішній хелпер для запитів до KeyCRM
async function kcFetch(path: string, init?: RequestInit) {
  if (!TOKEN) {
    throw new Error("Missing KEYCRM_API_TOKEN (check KEYCRM_API_URL/KEYCRM_BASE_URL)");
  }
  const res = await fetch(`${BASE}${path}`, {
    // KeyCRM очікує Bearer токен
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...init,
    // важливо не кешувати, бо нам потрібні свіжі дані
    cache: "no-store",
  });
  return res;
}

// GET /api/keycrm/cards?pipeline_id=&status_id=&page=&per_page=
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const pipeline_id = u.searchParams.get("pipeline_id");
    const status_id = u.searchParams.get("status_id");
    const page = u.searchParams.get("page") ?? "1";
    const per_page = u.searchParams.get("per_page") ?? "50";

    if (!pipeline_id || !status_id) {
      return NextResponse.json(
        { ok: false, error: "pipeline_id and status_id are required" },
        { status: 400 }
      );
    }

    const qs = new URLSearchParams({
      page,
      per_page,
      pipeline_id,
      status_id,
    });

    const res = await kcFetch(`/pipelines/cards?${qs.toString()}`);
    const data = await res.json();

    // просто прокидуємо відповідь KeyCRM (Laravel-стиль пагінації)
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "KeyCRM fetch failed" },
      { status: 500 }
    );
  }
}
