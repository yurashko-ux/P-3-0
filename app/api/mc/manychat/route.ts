// app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { getActiveCampaign } from "@/lib/campaigns";
import { kcFindCardIdInScope, kcMoveCard } from "@/lib/keycrm-scope";

type BodyIn = {
  username?: string;
  text?: string;
  // різні варіанти, які ManyChat може прислати:
  full_name?: string;
  fullname?: string;
  fullName?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
};

export const dynamic = "force-dynamic";

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr.filter(Boolean))) as T[];
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const qsPipeline = url.searchParams.get("pipeline_id");
    const qsStatus = url.searchParams.get("status_id");
    const body = (await req.json()) as BodyIn;

    // Нормалізація вхідних полів
    const username = (body.username || "").trim();
    const text = (body.text || "").trim();

    const fullNames = uniq<string>([
      body.full_name?.trim(),
      body.fullname?.trim(),
      body.fullName?.trim(),
      body.name?.trim(),
      body.first_name && body.last_name
        ? `${body.first_name.trim()} ${body.last_name.trim()}`
        : "",
    ]);

    // 1) Визначаємо базову воронку/статус зі створеної АКТИВНОЇ кампанії
    let basePipelineId: number | null = qsPipeline ? Number(qsPipeline) : null;
    let baseStatusId: number | null = qsStatus ? Number(qsStatus) : null;

    if (!basePipelineId || !baseStatusId) {
      const campaign = await getActiveCampaign();
      if (!campaign) {
        return NextResponse.json(
          {
            ok: false,
            error: "no_active_campaign",
            hint: "Створи або активуй кампанію. Вебхук бере базову воронку/статус з активної кампанії.",
            received: { username, text, fullNames },
          },
          { status: 200 }
        );
      }
      basePipelineId = campaign.base?.pipeline_id ?? null;
      baseStatusId = campaign.base?.status_id ?? null;

      if (!basePipelineId || !baseStatusId) {
        return NextResponse.json(
          {
            ok: false,
            error: "campaign_base_missing",
            hint: "В активній кампанії не заповнені base.pipeline_id / base.status_id.",
            campaign,
          },
          { status: 200 }
        );
      }

      // Перевага query-параметрам, якщо вони були передані явно
      if (qsPipeline) basePipelineId = Number(qsPipeline);
      if (qsStatus) baseStatusId = Number(qsStatus);
    }

    // 2) Шукаємо картку лише у межах базової пари (pipeline+status)
    const { cardId, checked, pages } = await kcFindCardIdInScope({
      username,
      fullNames,
      pipeline_id: basePipelineId!,
      status_id: baseStatusId!,
      max_pages: 3, // щоб не ходити по всій базі
    });

    if (!cardId) {
      return NextResponse.json(
        {
          ok: false,
          error: "card_not_found_in_campaign_scope",
          hint:
            "Картку не знайдено в межах базової воронки/статусу активної кампанії. " +
            "Перевір IG username (contact.social_id) або title «Чат з <ПІБ>».",
          scope: { pipeline_id: basePipelineId, status_id: baseStatusId },
          debug: { username, fullNames, checked, pages, text },
        },
        { status: 200 }
      );
    }

    // 3) Якщо є збіг по тригеру — переміщуємо картку у відповідний етап кампанії
    const campaign = await getActiveCampaign(); // повторно беремо для таргетів
    const normalizedText = text.trim();

    type Target = { pipeline_id: number; status_id: number } | null;
    let target: Target = null;

    const v1Trig = campaign?.v1?.trigger?.toString() ?? "1";
    const v2Trig = campaign?.v2?.trigger?.toString() ?? "2";
    const expTrig = campaign?.exp?.trigger?.toString() ?? "7";

    if (normalizedText === v1Trig && campaign?.v1) {
      target = {
        pipeline_id: campaign.v1.pipeline_id,
        status_id: campaign.v1.status_id,
      };
    } else if (normalizedText === v2Trig && campaign?.v2) {
      target = {
        pipeline_id: campaign.v2.pipeline_id,
        status_id: campaign.v2.status_id,
      };
    } else if (normalizedText === expTrig && campaign?.exp) {
      target = {
        pipeline_id: campaign.exp.pipeline_id,
        status_id: campaign.exp.status_id,
      };
    }

    let move: any = null;
    if (target) {
      move = await kcMoveCard(cardId, target.pipeline_id, target.status_id);
    }

    return NextResponse.json(
      {
        ok: true,
        via: "manychat",
        found: { card_id: cardId, checked, pages },
        applied_trigger: target ? normalizedText : null,
        move,
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
