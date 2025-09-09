// web/app/api/mc/ingest/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

// -------------------- helpers --------------------
function normIg(u: any): string {
  return String(u ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function str(v: any, d = "") {
  return v == null ? d : String(v);
}

const KEYCRM_BASE =
  process.env.KEYCRM_BASE_URL?.replace(/\/+$/, "") || "https://openapi.keycrm.app/v1";
const KEYCRM_TOKEN =
  process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

// універсальний виклик KeyCRM
async function kcrm(path: string, init?: RequestInit) {
  if (!KEYCRM_TOKEN) {
    return { ok: false, status: 401, error: "KEYCRM not configured" } as const;
  }
  const r = await fetch(`${KEYCRM_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${KEYCRM_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...init,
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, status: 502, error: "keycrm fetch failed" } as const;

  let json: any = null;
  try {
    json = await r.json();
  } catch {}

  return { ok: r.ok, status: r.status, json };
}

// пошук картки за title (точна / майже точна відповідність)
async function findCardIdByTitle(title: string): Promise<string | null> {
  const t = title.trim();
  if (!t) return null;

  // пробуємо кілька популярних варіантів фільтрації
  const attempts = [
    `/cards?title=${encodeURIComponent(t)}&limit=5`,
    `/cards?filter[title]=${encodeURIComponent(t)}&limit=5`,
    `/cards?search=${encodeURIComponent(t)}&limit=5`,
    `/cards/search?query=${encodeURIComponent(t)}&limit=5`,
  ];

  for (const p of attempts) {
    const res = await kcrm(p);
    if (!res.ok) continue;

    const data = (res.json?.data ?? res.json?.items ?? res.json?.results ?? []) as any[];
    if (!Array.isArray(data) || data.length === 0) continue;

    // 1) ідеальна рівність
    const exact = data.find((it) => String(it?.title ?? "").trim().toLowerCase() === t.toLowerCase());
    if (exact?.id) return String(exact.id);

    // 2) перший більш-менш підходящий елемент
    const first = data.find((it) => it?.id);
    if (first?.id) return String(first.id);
  }

  return null;
}

// отримати картку (щоб перевірити поточний pipeline/status)
async function getCard(card_id: string) {
  const res = await kcrm(`/cards/${encodeURIComponent(card_id)}`);
  if (!res.ok) return null;
  return res.json?.data ?? res.json;
}

// рух карти у вказаний pipeline/status
async function moveCard(card_id: string, to_pipeline_id?: string | null, to_status_id?: string | null) {
  const body: any = {};
  if (to_pipeline_id) body.pipeline_id = to_pipeline_id;
  if (to_status_id) body.status_id = to_status_id;

  if (!body.pipeline_id && !body.status_id) {
    return { ok: true, via: "PUT pipelines/cards/{id} (noop)", status: 200 };
  }

  const res = await kcrm(`/pipelines/cards/${encodeURIComponent(card_id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return { ok: res.ok, via: "PUT pipelines/cards/{id}", status: res.status };
}

type Op = "contains" | "equals";

function match(op: Op, fieldValue: string, probe: string) {
  const a = fieldValue.toLowerCase();
  const b = probe.toLowerCase();
  return op === "equals" ? a === b : a.includes(b);
}

// -------------------- main --------------------
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const qpCard = url.searchParams.get("card_id");

    const b = await req.json().catch(() => ({}));

    // витягуємо дані з ManyChat-пейлоада
    const rawUsername =
      b?.username ??
      b?.user?.username ??
      b?.contact?.username ??
      b?.contact?.name;

    const username = normIg(rawUsername);
    const text = str(b?.text).trim();

    // ManyChat може передати numeric instagram_user_id / contact.id
    const igId =
      str(b?.ig_id) ||
      str(b?.user?.id) ||
      str(b?.contact?.id);

    // card_id з тіла/квері має найвищий пріоритет
    let card_id = str(b?.card_id) || str(qpCard);

    // якщо card_id немає — пробуємо KV-кеш (щоб не шукати щоразу)
    if (!card_id && username) {
      const cached = await kvGet(`map:ig:${username}`);
      if (cached) card_id = cached;
    }

    // немає в KV — шукаємо в KeyCRM по title
    if (!card_id) {
      const candidates = [igId, username].filter(Boolean);
      for (const t of candidates) {
        const found = await findCardIdByTitle(t);
        if (found) {
          card_id = found;
          // закешуємо на майбутнє (по username)
          if (username) await kvSet(`map:ig:${username}`, card_id);
          break;
        }
      }
    }

    if (!card_id) {
      return NextResponse.json({
        ok: false,
        reason: "card_not_found",
        tried: { igId: igId || null, username: username || null },
      });
    }

    if (!KEYCRM_TOKEN) {
      return NextResponse.json({
        ok: false,
        error: "KEYCRM not configured",
        need: { KEYCRM_API_TOKEN: true },
      }, { status: 401 });
    }

    // тягнемо всі кампанії (enabled), застосовуємо першу, що підходить
    const ids = (await kvZRange("campaigns:index", 0, -1)) as string[];
    const campaigns: any[] = [];
    for (const id of ids ?? []) {
      const raw = await kvGet(`campaigns:${id}`);
      if (raw) {
        try {
          const j = JSON.parse(raw);
          if (j?.enabled !== false) campaigns.push(j);
        } catch {}
      }
    }

    if (!campaigns.length) {
      return NextResponse.json({ ok: true, applied: null, note: "no enabled campaigns" });
    }

    // поточний стан картки (щоб перевірити «базу»)
    const card = await getCard(card_id);
    const cardPipeline = str(card?.pipeline_id);
    const cardStatus = str(card?.status_id);

    let applied: "v1" | "v2" | null = null;
    let moveRes: any = null;
    let usedCampaignId: string | null = null;

    for (const c of campaigns) {
      // база: якщо задана, перевіряємо
      const baseOk =
        (!c.base_pipeline_id || str(c.base_pipeline_id) === cardPipeline) &&
        (!c.base_status_id || str(c.base_status_id) === cardStatus);

      if (!baseOk) continue;

      // V1 завжди активний
      if (
        match((c.v1_op as Op) || "contains", text, str(c.v1_value)) &&
        (c.v1_to_pipeline_id || c.v1_to_status_id)
      ) {
        moveRes = await moveCard(card_id, str(c.v1_to_pipeline_id) || null, str(c.v1_to_status_id) || null);
        applied = "v1";
        usedCampaignId = c.id;
      }
      // V2 опційний
      else if (
        c.v2_enabled &&
        match((c.v2_op as Op) || "contains", text, str(c.v2_value)) &&
        (c.v2_to_pipeline_id || c.v2_to_status_id)
      ) {
        moveRes = await moveCard(card_id, str(c.v2_to_pipeline_id) || null, str(c.v2_to_status_id) || null);
        applied = "v2";
        usedCampaignId = c.id;
      }

      if (applied) {
        // оновимо лічильник у кампанії
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
      debug: { username, igId: igId || null, card_id, text },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "ingest failed" },
      { status: 500 }
    );
  }
}
