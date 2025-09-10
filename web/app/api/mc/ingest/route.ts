// web/app/api/mc/ingest/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";
import { kcFindCardIdByTitle, kcMoveCard } from "@/lib/keycrm";

export const dynamic = "force-dynamic";

function str(v: any, d = "") { return v == null ? d : String(v); }
function normAt(s: string) { return s.trim().replace(/^@/, ""); }
function lower(s: string) { return s.toLowerCase(); }
type Op = "contains" | "equals";

function match(op: Op, source: string, probe: string) {
  const a = source.toLowerCase();
  const b = probe.toLowerCase();
  return op === "equals" ? a === b : a.includes(b);
}

// --- KeyCRM helpers (локально тільки читання картки) ---
const KEYCRM_BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const KEYCRM_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

async function kcGet(path: string) {
  if (!KEYCRM_TOKEN) return { ok: false, status: 401, json: null };
  const r = await fetch(`${KEYCRM_BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEYCRM_TOKEN}` },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: null };
  let json: any = null; try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json };
}

async function getCard(cardId: string) {
  const res = await kcGet(`/cards/${encodeURIComponent(cardId)}`);
  if (!res.ok) return null;
  return res.json?.data ?? res.json ?? null;
}

// --- resolve card_id за username ---
async function resolveCardId(usernameRaw: string): Promise<string> {
  const username = normAt(str(usernameRaw));
  if (!username) return "";

  // 1) KV-кеш по lower-ключу
  const key = `map:ig:${lower(username)}`;
  const cached = await kvGet(key);
  if (cached) {
    try {
      const j = JSON.parse(cached);
      if (j?.value) return String(j.value);
    } catch {}
    return String(cached);
  }

  // 2) KeyCRM: title === username (як є), потім title === username.toLowerCase()
  const attempts = [username, lower(username)];
  for (const title of attempts) {
    const found = await kcFindCardIdByTitle(title);
    if (found) {
      const id = String(found);
      // закешуємо для швидкості подальших звернень
      await kvSet(key, id);
      return id;
    }
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const usernameRaw = str(b.username);
    const text = str(b.text).trim();

    // Quick guard
    if (!usernameRaw) {
      return NextResponse.json({ ok: false, error: "username required" }, { status: 400 });
    }

    // Знаходимо card_id
    let card_id = str(b.card_id);
    if (!card_id) {
      card_id = await resolveCardId(usernameRaw);
    }

    if (!card_id) {
      return NextResponse.json({
        ok: false,
        error: "card_not_found",
        hint: "Створіть у KeyCRM картку з title = instagram username_id або надішліть card_id",
        username: normAt(usernameRaw),
      });
    }

    if (!KEYCRM_TOKEN) {
      return NextResponse.json({
        ok: false, error: "KEYCRM not configured", need: { KEYCRM_API_TOKEN: true }
      }, { status: 401 });
    }

    // 1) тягнемо всі кампанії (enabled)
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
    if (!campaigns.length) {
      return NextResponse.json({ ok: true, applied: null, note: "no enabled campaigns" });
    }

    // 2) отримаємо поточний стан картки
    const card = await getCard(card_id);
    const cardPipeline = str(card?.pipeline_id);
    const cardStatus = str(card?.status_id);

    // 3) підберемо кампанію та застосуємо правило
    let applied: "v1" | "v2" | null = null;
    let moveRes: any = null;
    let usedCampaignId: string | null = null;

    for (const c of campaigns) {
      // база має збігатись, якщо задана
      const baseOk =
        (!c.base_pipeline_id || str(c.base_pipeline_id) === cardPipeline) &&
        (!c.base_status_id   || str(c.base_status_id)   === cardStatus);

      if (!baseOk) continue;

      // V1: обов’язковий блок
      if (
        match((c.v1_op as Op) || "contains", text, str(c.v1_value)) &&
        (c.v1_to_pipeline_id || c.v1_to_status_id)
      ) {
        moveRes = await kcMoveCard(card_id, {
          pipeline_id: c.v1_to_pipeline_id || undefined,
          status_id:   c.v1_to_status_id   || undefined,
          note: `V1 @${normAt(usernameRaw)}: "${text}"`,
        });
        applied = "v1";
        usedCampaignId = c.id;
      }
      // V2: опційний
      else if (
        c.v2_enabled &&
        match((c.v2_op as Op) || "contains", text, str(c.v2_value)) &&
        (c.v2_to_pipeline_id || c.v2_to_status_id)
      ) {
        moveRes = await kcMoveCard(card_id, {
          pipeline_id: c.v2_to_pipeline_id || undefined,
          status_id:   c.v2_to_status_id   || undefined,
          note: `V2 @${normAt(usernameRaw)}: "${text}"`,
        });
        applied = "v2";
        usedCampaignId = c.id;
      }

      if (applied) {
        // оновимо лічильник кампанії
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
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "ingest failed" }, { status: 500 });
  }
}
