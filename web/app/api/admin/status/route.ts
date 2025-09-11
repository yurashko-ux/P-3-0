// web/app/api/admin/status/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { kvZRange, kvGet } from "@/lib/kv";

export const dynamic = "force-dynamic";

const ADMIN = process.env.ADMIN_PASS ?? "";

function readBearer(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return "";
}
function readAdminAlt(req: Request): string {
  const x = req.headers.get("x-admin-pass") || "";
  if (x) return x.trim();
  const url = new URL(req.url);
  const q = url.searchParams.get("admin");
  if (q) return q.trim();
  return "";
}

function envSummary() {
  return {
    KEYCRM_API_TOKEN: !!process.env.KEYCRM_API_TOKEN,
    KEYCRM_BASE_URL: process.env.KEYCRM_BASE_URL || null,
    KV_REST_API_URL: !!(process.env.KV_REST_API_URL || process.env.KV_URL),
    KV_REST_API_TOKEN: !!(process.env.KV_REST_API_TOKEN || process.env.KV_TOKEN),
    ADMIN_PASS_SET: !!ADMIN,
  };
}

async function getCampaignsBrief() {
  const ids = await kvZRange("campaigns:index", 0, -1).catch(() => [] as string[]);
  const count = Array.isArray(ids) ? ids.length : 0;
  const sample: any[] = [];
  if (Array.isArray(ids) && ids.length) {
    const id = ids[ids.length - 1]; // остання (найновіша)
    const raw = await kvGet(`campaigns:${id}`).catch(() => null);
    if (raw) sample.push({ id, value: raw });
  }
  return { campaign_count: count, sample_campaigns: sample };
}

export async function GET(req: Request) {
  try {
    // приймаємо кілька способів: Authorization: Bearer ..., X-Admin-Pass, ?admin=...
    const bearer = readBearer(req);
    const alt = readAdminAlt(req);
    const cookiePass = cookies().get("admin_pass")?.value || "";
    const pass = bearer || alt || cookiePass;

    const auth_ok = !ADMIN || pass === ADMIN;

    // НЕ блокуємо 401 — повертаємо прапорець auth_ok для зручної перевірки з curl
    const env = envSummary();
    const brief = await getCampaignsBrief();

    return NextResponse.json({
      ok: true,
      auth_ok,
      env,
      ...brief,
      tips: {
        auth:
          "Передавайте: Authorization: Bearer <ADMIN_PASS> або X-Admin-Pass: <ADMIN_PASS> або ?admin=<ADMIN_PASS>",
        sync:
          "POST /api/keycrm/sync?max_pages=5&per_page=50 - з адмін-хедером; потім локальний пошук /api/keycrm/local/find?...",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "status_failed" },
      { status: 200 }
    );
  }
}
