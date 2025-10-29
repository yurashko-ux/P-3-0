// web/app/api/keycrm/inspect-card/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { baseUrl, ensureBearer } from "../_common";

export const dynamic = "force-dynamic";

const ADMIN = process.env.ADMIN_PASS ?? "";
const BASE = baseUrl();
const TOKEN = ensureBearer(
  process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_TOKEN ||
    ""
);

function okAuth(req: Request) {
  if (!ADMIN) return true;
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const cookiePass = cookies().get("admin_pass")?.value || "";
  const pass = token || cookiePass;
  return pass === ADMIN;
}

async function kcGet(path: string) {
  if (!TOKEN) {
    return { ok: false, status: 401, json: { error: "KEYCRM token missing" } };
  }
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: TOKEN },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: { error: "fetch failed" } };
  let json: any = null;
  try { json = await r.json(); } catch {}
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

  // 1) Деталі картки в контексті pipelines (точно містить pipeline_id/status_id/CONTACT_ID)
  const pipelinesCard = await kcGet(`/pipelines/cards/${encodeURIComponent(cardId)}`);

  // 2) Базова картка (може бути 404 — окей)
  const baseCard = await kcGet(`/cards/${encodeURIComponent(cardId)}`);

  // 3) Спробуємо підтягнути контакт за contact_id (якщо є)
  const contactId =
    pipelinesCard?.json?.data?.contact_id ??
    pipelinesCard?.json?.contact_id ??
    baseCard?.json?.data?.contact_id ??
    baseCard?.json?.contact_id ??
    null;

  let contactMain: any = null;
  let contactMessengers: any = null;
  let contactSocials: any = null;
  let contactLinks: any = null;
  let contactExtra1: any = null; // запасні варіанти назв
  let contactExtra2: any = null;

  if (contactId) {
    // Основний контакт
    contactMain = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}`);

    // Типові місця для соцмереж / месенджерів — спробуємо кілька варіантів
    contactMessengers = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}/messengers`);
    contactSocials    = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}/socials`);
    contactLinks      = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}/links`);

    // запасні (на випадок іншої термінології в API)
    contactExtra1     = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}/social-networks`);
    contactExtra2     = await kcGet(`/contacts/${encodeURIComponent(String(contactId))}/profiles`);
  }

  return NextResponse.json({
    ok: true,
    hint:
      "Шукай IG username у одному з цих місць: " +
      "response.contactMain.json.data.*, " +
      "response.contactMessengers.json.*, " +
      "response.contactSocials.json.*, " +
      "response.contactLinks.json.*, " +
      "response.contactExtra1/2.json.*. " +
      "Коли побачиш точний шлях (ключ/масив), напиши мені — я оновлю пошук.",
    base_url: BASE,
    card_id: cardId,
    contact_id: contactId ?? null,
    endpoints: {
      pipelines_cards: `/pipelines/cards/${cardId}`,
      cards: `/cards/${cardId}`,
      contact: contactId ? `/contacts/${contactId}` : null,
      contact_messengers: contactId ? `/contacts/${contactId}/messengers` : null,
      contact_socials: contactId ? `/contacts/${contactId}/socials` : null,
      contact_links: contactId ? `/contacts/${contactId}/links` : null,
      contact_social_networks: contactId ? `/contacts/${contactId}/social-networks` : null,
      contact_profiles: contactId ? `/contacts/${contactId}/profiles` : null,
    },
    response: {
      pipelines_cards: pipelinesCard,
      cards: baseCard,
      contactMain,
      contactMessengers,
      contactSocials,
      contactLinks,
      contactExtra1,
      contactExtra2,
    },
  });
}
