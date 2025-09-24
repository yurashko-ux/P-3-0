// web/app/api/campaigns/seed/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST() {
  const h = headers();
  const host = h.get("host")!;
  // На Vercel все за HTTPS, але лишимо перевірку:
  const proto = (h.get("x-forwarded-proto") || "").includes("http") ? "https" : "https";
  const base = `${proto}://${host}`;

  const adminToken = process.env.ADMIN_PASS || "11111";

  const payloads = [
    {
      name: "Demo campaign A",
      base_pipeline_id: 111,
      base_status_id: 222,
      rules: { v1: { op: "contains", value: "ціна" }, v2: { op: "equals", value: "привіт" } },
    },
    {
      name: "Demo campaign B",
      base_pipeline_id: 6,
      base_status_id: 68,
      rules: { v1: { op: "contains", value: "замов" }, v2: { op: "contains", value: "оплата" } },
    },
  ];

  const created: any[] = [];
  for (const body of payloads) {
    const res = await fetch(`${base}/api/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    created.push({ status: res.status, ok: res.ok, json });
  }

  const list = await fetch(`${base}/api/campaigns`, {
    cache: "no-store",
    headers: { cookie: h.get("cookie") ?? "" },
  }).then((r) => r.json()).catch(() => ({ ok: false }));

  return NextResponse.json({ ok: true, created, after: list }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST" },
    { status: 405, headers: { "Cache-Control": "no-store" } }
  );
}
