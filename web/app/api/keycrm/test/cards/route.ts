// web/app/api/keycrm/test/cards/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/keycrm/test/cards?pipeline_id=&status_id=&page=1&per_page=50
 * Адмін-автентифікація:
 *  - Header:  Authorization: Bearer <ADMIN_PASS>
 *  - або ?admin=<ADMIN_PASS>
 *
 * Потрібні ENV:
 *  - KEYCRM_API_TOKEN
 *  - KEYCRM_BASE_URL (за замовчуванням https://openapi.keycrm.app/v1)
 */
export async function GET(req: Request) {
  // ---- admin guard
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

  // ---- params
  const pipeline_id = url.searchParams.get("pipeline_id");
  const status_id = url.searchParams.get("status_id");
  const page = url.searchParams.get("page") ?? "1";
  const per_page = url.searchParams.get("per_page") ?? "50";

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

  const qs = new URLSearchParams({
    page,
    per_page,
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
    // Важливо для Vercel/Next, щоб не кешувалося під час тестів
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

  return NextResponse.json({ ok: true, url: kcUrl, data: json });
}
