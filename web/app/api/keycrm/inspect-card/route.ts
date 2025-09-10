// web/app/api/keycrm/inspect-card/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const ADMIN = process.env.ADMIN_PASS ?? "";
const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

function okAuth(req: Request) {
  if (!ADMIN) return true;
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const cookiePass = cookies().get("admin_pass")?.value || "";
  const pass = token || cookiePass;
  return pass === ADMIN;
}

async function kcGet(path: string) {
  if (!TOKEN) return { ok: false, status: 401, json: { error: "KEYCRM token missing" } };
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: { error: "fetch failed" } };
  let json: any = null; try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json };
}

export async function GET(req: Request) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const cardId = (searchParams.get("card_id") || "").trim();
  if (!cardId) {
    return NextResponse.json({ ok: false, error: "card_id required, e.g. ?card_id=435" }, { status: 400 });
  }

  // 1) Деталі картки в контексті pipelines (точно містить pipeline_id/status_id)
  const pipelinesCard = await kcGet(`/pipelines/cards/${encodeURIComponent(cardId)}`);

  // 2) Базова картка (інша форма; інколи зручніше бачити сирі поля)
  const baseCard = await kcGet(`/cards/${encodeURIComponent(cardId)}`);

  // 3) Якщо у відповіді є client_id — підтягнемо і клієнта (там часто зберігаються соцмережі)
  let client: any = null;
  const clientId =
    baseCard?.json?.data?.client_id ??
    baseCard?.json?.client_id ??
    pipelinesCard?.json?.data?.client_id ??
    pipelinesCard?.json?.client_id;

  if (clientId) {
    client = await kcGet(`/clients/${encodeURIComponent(String(clientId))}`);
  }

  return NextResponse.json({
    ok: true,
    hint: "Подивись, у якому полі лежить Instagram username (title, custom_fields, client.*). Далі скажи мені точний шлях поля, і я підлаштую пошук.",
    base_url: BASE,
    card_id: cardId,
    endpoints: {
      cards: `/cards/${cardId}`,
      pipelines_cards: `/pipelines/cards/${cardId}`,
      client: clientId ? `/clients/${clientId}` : null,
    },
    response: {
      pipelines_cards: pipelinesCard,
      cards: baseCard,
      client,
    },
  });
}
