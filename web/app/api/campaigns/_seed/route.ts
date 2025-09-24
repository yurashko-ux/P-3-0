// web/app/api/campaigns/_seed/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * POST /api/campaigns/_seed
 * Створює кілька демо-кампаній через внутрішній POST /api/campaigns
 * Потрібно, щоб у Vercel env був ADMIN_PASS (токен, яким ти логінишся /api/auth/set?token=...).
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const h = headers();
  const host = h.get("host")!;
  const proto =
    (h.get("x-forwarded-proto") || "").includes("https") ? "https" : "https";
  const base = `${proto}://${host}`;

  const token = process.env.ADMIN_PASS || "11111"; // fallback на твій тестовий

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

  const results: any[] = [];
  for (const body of payloads) {
    const res = await fetch(`${base}/api/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    results.push({ status: res.status, ok: res.ok, json });
  }

  // Після сіду знімаємо зліпок списку для перевірки
  const after = await fetch(`${base}/api/campaigns`, {
    cache: "no-store",
    headers: { cookie: h.get("cookie") ?? "" },
  }).then((r) => r.json()).catch(() => ({ ok: false }));

  return NextResponse.json({
    ok: true,
    created: results,
    after,
  }, { headers: { "Cache-Control": "no-store" } });
}
