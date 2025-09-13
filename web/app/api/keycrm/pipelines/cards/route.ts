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

    const upstream = new URL(`${BASE}/pipelines/cards`);
    // прокидуємо підтримувані фільтри
    ["pipeline_id", "status_id", "per_page", "page"].forEach((k) => {
      const v = q.get(k);
      if (v) upstream.searchParams.set(k, v);
    });
    if (!upstream.searchParams.has("per_page")) upstream.searchParams.set("per_page", "50");
    if (!upstream.searchParams.has("page")) upstream.searchParams.set("page", "1");

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
