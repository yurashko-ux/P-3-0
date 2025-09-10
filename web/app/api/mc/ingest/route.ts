// web/app/api/mc/ingest/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";
import {
  kcMoveCard,
  kcGetCardState,
  kcFindCardIdByTitleSmart, // <-- новий розумний пошук по title
} from "@/lib/keycrm";

export const dynamic = "force-dynamic";

const s = (v: unknown, d = "") => (v == null ? d : String(v));
const normAt = (u: string) => u.trim().replace(/^@/, "");
type Op = "contains" | "equals";
const match = (op: Op, source: string, probe: string) =>
  op === "equals"
    ? source.toLowerCase() === probe.toLowerCase()
    : source.toLowerCase().includes(probe.toLowerCase());

async function resolveCardIdByUsername(usernameRaw: string): Promise<string> {
  const u = normAt(s(usernameRaw));
  if (!u) return "";

  const key = `map:ig:${u.toLowerCase()}`;
  const cached = await kvGet(key);
  if (cached) {
    try {
      const j = JSON.parse(cached);
      if (j?.value) return String(j.value);
    } catch {}
    return String(cached);
  }

  const found = await kcFindCardIdByTitleSmart(u);
  if (found) {
    await kvSet(key, found);
    return found;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const usernameRaw = s(body.username);
    const text = s(body.text).trim();

    if (!usernameRaw) {
      return NextResponse.json({ ok: false, error: "username required" }, { status: 400 });
    }

    // ❗️ІГНОРУЄМО будь-який card_id із ManyChat; завжди шукаємо по title==username
    const card_id = await resolveCardIdByUsername(usernameRaw);
    if (!card_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "card_not_found_by_title",
          hint: 'У KeyCRM має існувати лід, у якого "title" = instagram username (без "@")',
          username: normAt(usernameRaw),
        },
        { status: 404 }
      );
    }

    // тягнемо активні кампанії
    const ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | null;
    const campaigns: any[] = [];
    for (const id of ids || []) {
      const raw = await kvGet(`campaigns:${id}`);
      if (!raw) continue;
      try {
        const c = JSON.parse(raw);
        if (c?.enabled !== false) campaigns.push(c);
      } catch {}
    }

    // актуальний стан картки
    const state = await kcGetCardState(card_id);
    const cardPipeline = s(state?.pipeline_id);
    const cardStatus = s(state?.status_id);

    // перевіряємо правила
    const checks: any[] = [];
    let applied: "v1" | "v2" | null = null;
    let usedCampaignId: string | null = null;
    let moveRes: any = null;

    for (const c of campaigns) {
      const baseOk =
        (!c.base_pipeline_id || s(c.base_pipeline_id) === cardPipeline) &&
        (!c.base_status_id || s(c.base_status_id) === cardStatus);

      const v1Probe = { op: (c.v1_op as Op) || "contains", value: s(c.v1_value) };
      const v2Probe = { op: (c.v2_op as Op) || "contains", value: s(c.v2_value) };
      const v1Hit = !!(v1Probe.value && match(v1Probe.op, text, v1Probe.value));
      const v2Hit = !!(c.v2_enabled && v2Probe.value && match(v2Probe.op, text, v2Probe.value));

      checks.push({
        campaign_id: c.id,
        base: {
          required: { pipeline: s(c.base_pipeline_id), status: s(c.base_status_id) },
          actual: { pipeline: cardPipeline, status: cardStatus },
          ok: baseOk,
        },
        v1: { probe: v1Probe, hit: v1Hit, to: { pipeline: s(c.v1_to_pipeline_id), status: s(c.v1_to_status_id) } },
        v2: { enabled: !!c.v2_enabled, probe: v2Probe, hit: v2Hit, to: { pipeline: s(c.v2_to_pipeline_id), status: s(c.v2_to_status_id) } },
      });

      if (!baseOk) continue;

      if (v1Hit && (c.v1_to_pipeline_id || c.v1_to_status_id)) {
        moveRes = await kcMoveCard(card_id, {
          pipeline_id: c.v1_to_pipeline_id || undefined,
          status_id: c.v1_to_status_id || undefined,
          note: `V1 @${normAt(usernameRaw)}: "${text}"`,
        });
        applied = "v1";
        usedCampaignId = c.id;
      } else if (v2Hit && (c.v2_to_pipeline_id || c.v2_to_status_id)) {
        moveRes = await kcMoveCard(card_id, {
          pipeline_id: c.v2_to_pipeline_id || undefined,
          status_id: c.v2_to_status_id || undefined,
          note: `V2 @${normAt(usernameRaw)}: "${text}"`,
        });
        applied = "v2";
        usedCampaignId = c.id;
      }

      if (applied) {
        try {
          const raw = await kvGet(`campaigns:${c.id}`);
          if (raw) {
            const obj = JSON.parse(raw);
            if (applied === "v1") obj.v1_count = (obj.v1_count || 0) + 1;
            if (applied === "v2") obj.v2_count = (obj.v2_count || 0) + 1;
            obj.updated_at = new Date().toISOString();
            await kvSet(`campaigns:${c.id}`, JSON.stringify(obj));
          }
        } catch {}
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      applied,
      campaign_id: usedCampaignId,
      move: moveRes || null,
      debug: {
        username: normAt(usernameRaw),
        card_id,
        text,
        card_state: { pipeline_id: cardPipeline, status_id: cardStatus },
        checks,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "ingest failed" }, { status: 500 });
  }
}
