// web/app/api/keycrm/inspect-contact/route.ts
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
  if (!TOKEN) return { ok: false, status: 401, json: { error: "KEYCRM token missing" }, path };
  const url = `${BASE}${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store" }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: { error: "fetch failed" }, path };
  let json: any = null; try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json, path };
}

// намагаємося вичитати contact_id із картки
async function getContactIdByCard(cardId: string): Promise<string | null> {
  const r = await kcGet(`/pipelines/cards/${encodeURIComponent(cardId)}`);
  const d = r?.json?.data ?? r?.json ?? null;
  const id = d?.contact_id ?? d?.client_id ?? null;
  return id ? String(id) : null;
}

// простий пошук по всьому JSON на вміст "instagram"
function findInstagramHints(obj: any, pathPrefix = ""): Array<{ path: string; value: any }> {
  const hits: Array<{ path: string; value: any }> = [];
  const visit = (v: any, p: string) => {
    if (v == null) return;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (s.includes("instagram") || s.includes("insta") || s.includes("instagram.com")) {
        hits.push({ path: p, value: v });
      }
    } else if (Array.isArray(v)) {
      v.forEach((el, i) => visit(el, `${p}[${i}]`));
    } else if (typeof v === "object") {
      for (const k of Object.keys(v)) visit(v[k], p ? `${p}.${k}` : k);
    }
  };
  visit(obj, pathPrefix);
  return hits;
}

export async function GET(req: Request) {
  if (!okAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const contactId = (url.searchParams.get("contact_id") || "").trim();
  const cardId = (url.searchParams.get("card_id") || "").trim();

  let cid = contactId;
  if (!cid && cardId) cid = (await getContactIdByCard(cardId)) || "";

  if (!cid) {
    return NextResponse.json(
      { ok: false, error: "Provide ?contact_id=... or ?card_id=... to resolve contact_id" },
      { status: 400 }
    );
  }

  // Набір кандидатів, які перевіримо
  const paths = [
    `/clients/${cid}`,
    `/clients/${cid}/socials`,
    `/clients/${cid}/messengers`,
    `/clients/${cid}/profiles`,
    `/clients/${cid}/links`,
    `/clients/${cid}/social-networks`,
    `/clients/${cid}/custom-fields`,
    `/contacts/${cid}`,
    `/contacts/${cid}/socials`,
    `/contacts/${cid}/messengers`,
    `/contacts/${cid}/profiles`,
    `/contacts/${cid}/links`,
    `/contacts/${cid}/social-networks`,
    `/contacts/${cid}/custom-fields`,
  ];

  const tried: any[] = [];
  const instagram: Array<{ endpoint: string; hits: Array<{ path: string; value: any }> }> = [];

  for (const p of paths) {
    const r = await kcGet(p);
    tried.push({ path: r.path, status: r.status, ok: r.ok, hasJson: r.json != null });
    if (r.ok && r.json) {
      // вирахуємо кореневий вузол даних для зручності
      const data = Array.isArray(r.json?.data) || Array.isArray(r.json) ? r.json : (r.json?.data ?? r.json);
      const hits = findInstagramHints(data, "data");
      if (hits.length) instagram.push({ endpoint: p, hits });
    }
  }

  return NextResponse.json({
    ok: true,
    base_url: BASE,
    contact_id: cid,
    summary: {
      success_count: tried.filter((t: any) => t.ok).length,
      instagram_hits: instagram.length,
    },
    tried,
    instagram, // тут буде список шляхів у JSON, де знайдено instagram
    next_hint:
      "Знайди у instagram[].hits шлях (path), де видно логін — напиши мені його, і я підлаштую пошук у бекенді під точне поле.",
  });
}
