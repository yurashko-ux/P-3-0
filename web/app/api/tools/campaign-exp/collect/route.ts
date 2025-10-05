// web/app/api/tools/campaign-exp/collect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";
import { collectBaseCards, resolveBasePair } from "@/lib/campaign-exp";
import { Campaign } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeToken(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) return trimmed.slice(7);
  return trimmed;
}

function isAdmin(req: NextRequest) {
  const pass = process.env.ADMIN_PASS || "";
  if (!pass) return true;
  const bearer = normalizeToken(req.headers.get("authorization"));
  const header = req.headers.get("x-admin-token") || "";
  const qs = req.nextUrl.searchParams.get("token") || req.nextUrl.searchParams.get("admin") || "";
  const cookie = req.cookies.get("admin_pass")?.value || "";
  return [bearer, header, qs, cookie].some((v) => v === pass);
}

function bad(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

function ok(payload: any) {
  return NextResponse.json({ ok: true, ...payload });
}

async function findCampaign(id: string): Promise<Campaign | undefined> {
  try {
    const list = await kvRead.listCampaigns<Campaign>();
    return list.find((c) => String(c.id) === id);
  } catch {
    return undefined;
  }
}

async function handleCollect(campaignId: string) {
  const campaign = await findCampaign(campaignId);
  if (!campaign) {
    return bad(404, "campaign_not_found", { campaignId });
  }

  if (!resolveBasePair(campaign)) {
    return bad(400, "campaign_base_missing", { campaignId });
  }

  const result = await collectBaseCards(campaign);
  if (!result.ok) {
    return bad(502, result.message || "collect_failed", { result });
  }

  return ok({ result });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return bad(401, "unauthorized");
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const campaignId = String(body?.campaign_id ?? body?.campaignId ?? "").trim();
  if (!campaignId) {
    return bad(400, "campaign_id_required");
  }

  return handleCollect(campaignId);
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return bad(401, "unauthorized");
  }
  const campaignId = req.nextUrl.searchParams.get("campaign_id") || req.nextUrl.searchParams.get("campaignId") || "";
  if (!campaignId) {
    return bad(400, "campaign_id_required");
  }
  return handleCollect(campaignId);
}
