import { NextRequest, NextResponse } from "next/server";
import { findCardSimple } from "@/lib/keycrm-find";
import { kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";

type Scope = "campaign" | "global";
type Strategy = "social" | "full_name" | "both";
type TitleMode = "exact" | "contains";

type CampaignBase = {
  pipeline_id?: number;
  status_id?: number;
  source?: string;
};

function norm(value?: string | null) {
  return value ? value.trim() : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function resolveActiveCampaignBase(): Promise<CampaignBase | null> {
  try {
    const campaigns = await kvRead.listCampaigns<any>();
    for (const campaign of campaigns) {
      if (!campaign || campaign.deleted) continue;
      if (campaign.active === false) continue;

      const pipelineCandidates = [
        campaign.base_pipeline_id,
        campaign.base?.pipeline,
        campaign.base?.pipeline_id,
        campaign.base?.pipelineId,
        campaign.basePipelineId,
        campaign.base_pipeline,
      ];
      const statusCandidates = [
        campaign.base_status_id,
        campaign.base?.status,
        campaign.base?.status_id,
        campaign.base?.statusId,
        campaign.baseStatusId,
        campaign.base_status,
      ];

      const pipeline_id = pipelineCandidates
        .map(toNumber)
        .find((value) => typeof value === "number");
      const status_id = statusCandidates
        .map(toNumber)
        .find((value) => typeof value === "number");

      if (pipeline_id && status_id) {
        return {
          pipeline_id,
          status_id,
          source: campaign.id ? String(campaign.id) : undefined,
        };
      }
    }
  } catch {
    // ignore KV errors; fallback to global scope
  }
  return null;
}

function parseStrategy(value: string | undefined): Strategy {
  if (value === "social" || value === "full_name" || value === "both") return value;
  return "both";
}

function parseScope(value: string | undefined): Scope | undefined {
  if (value === "campaign" || value === "global") return value;
  return undefined;
}

function parseTitleMode(value: string | undefined): TitleMode {
  if (value === "contains") return "contains";
  return "exact";
}

function clampNumber(value: number | undefined, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (key: string) => norm(url.searchParams.get(key));

    const handle = q("handle") ?? q("instagram") ?? q("ig") ?? undefined;
    const social_id = q("social_id") ?? handle;
    const full_name = q("full_name") ?? handle;
    const social_name = q("social_name") ?? (social_id ? "instagram" : undefined);

    let pipeline_id = toNumber(q("pipeline_id"));
    let status_id = toNumber(q("status_id"));

    const max_pages = clampNumber(toNumber(q("max_pages")) ?? 3, 1, 50);
    const page_size = clampNumber(toNumber(q("page_size")) ?? 50, 1, 100);
    const strategy = parseStrategy(q("strategy"));
    const title_mode = parseTitleMode(q("title_mode"));

    let scope = parseScope(q("scope"));
    let scopeSource: CampaignBase | null = null;

    if (!social_id && !full_name) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_lookup_keys",
          message: "Передай handle (instagram) або явні social_id / full_name.",
        },
        { status: 200 }
      );
    }

    if (!scope || scope === "campaign") {
      scopeSource = await resolveActiveCampaignBase();
      if (!scope && scopeSource?.pipeline_id && scopeSource?.status_id) {
        scope = "campaign";
      } else if (!scope) {
        scope = "global";
      }
    }

    if (scope === "campaign") {
      if (pipeline_id == null || status_id == null) {
        pipeline_id = pipeline_id ?? scopeSource?.pipeline_id;
        status_id = status_id ?? scopeSource?.status_id;
      }

      if (pipeline_id == null || status_id == null) {
        return NextResponse.json(
          {
            ok: false,
            error: "campaign_scope_missing",
            message:
              "Для scope=campaign потрібні pipeline_id та status_id (налаштуй активну кампанію або передай їх у запиті).",
            requested: {
              handle: handle ?? null,
              social_id: social_id ?? null,
              full_name: full_name ?? null,
              social_name: social_name ?? null,
              pipeline_id: pipeline_id ?? null,
              status_id: status_id ?? null,
              scope,
            },
          },
          { status: 200 }
        );
      }
    }

    const payload = {
      social_id,
      full_name,
      social_name,
      pipeline_id: pipeline_id ?? undefined,
      status_id: status_id ?? undefined,
      max_pages,
      page_size,
      strategy,
      title_mode,
      scope: scope ?? "global",
    } as const;

    const result = await findCardSimple(payload);

    return NextResponse.json(
      {
        ...result,
        requested: {
          handle: handle ?? null,
          social_id: social_id ?? null,
          full_name: full_name ?? null,
          social_name: social_name ?? null,
          pipeline_id: pipeline_id ?? null,
          status_id: status_id ?? null,
          scope: payload.scope,
          strategy: payload.strategy,
          title_mode: payload.title_mode,
          campaign_source: scopeSource?.source ?? null,
        },
        attempts: [
          social_id
            ? { key: "contact.social_id", value: social_id, platform: social_name ?? null }
            : null,
          full_name
            ? { key: "contact.full_name", value: full_name, title_mode: payload.title_mode }
            : null,
        ].filter(Boolean),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || String(err) },
      { status: 200 }
    );
  }
}
