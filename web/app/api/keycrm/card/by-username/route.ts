// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

function norm(s: string) {
  return (s || "").trim().replace(/^@+/, "").toLowerCase();
}
function longestToken(u: string) {
  const toks = norm(u).split(/[^a-zа-яёіїє0-9]+/gi).filter(Boolean);
  return toks.sort((a, b) => b.length - a.length)[0] || "";
}

async function kcGet(path: string) {
  if (!TOKEN) throw new Error("KeyCRM token missing");
  const url = path.startsWith("http") ? path : `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: null };
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json };
}

function extractItems(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  return [];
}

/**
 * Пошук картки за contact.social_id:
 * 1) /pipelines/cards?search=<username> (до 5 сторінок)
 * 2) якщо ні — /pipelines/cards?search=<longestToken> (до 5 сторінок)
 * 3) якщо ні — переглядаємо останні N сторінок без фільтру (до 5 сторінок по 100)
 * У кожному кандидатові перевіряємо it.contact?.social_id === username (нормалізовано)
 */
async function findByContactSocialId(username: string): Promise<{ id: string | null; via: string }> {
  const target = norm(username);
  if (!target) return { id: null, via: "empty-username" };

  const attempts: Array<{ label: string; base: string }> = [
    { label: "search=username", base: `/pipelines/cards?search=${encodeURIComponent(username)}&page[size]=100` },
  ];

  const main = longestToken(username);
  if (main && main !== username) {
    attempts.push({ label: "search=longestToken", base: `/pipelines/cards?search=${encodeURIComponent(main)}&page[size]=100` });
  }

  for (const a of attempts) {
    for (let page = 1; page <= 5; page++) {
      const path = `${a.base}&page[number]=${page}`;
      const r = await kcGet(path);
      if (!r.ok) break;
      const items = extractItems(r.json);
      for (const it of items) {
        const id = String(it?.id ?? it?.card_id ?? "");
        const social = norm(it?.contact?.social_id ?? "");
        if (id && social && social === target) {
          return { id, via: a.label };
        }
      }
      // якщо нема meta — не йдемо далі сторінками
      const meta = r.json?.meta;
      const total = meta?.total || meta?.total_items;
      const perPage = meta?.per_page || meta?.page_size || 100;
      const current = meta?.current_page || page;
      const last = meta?.last_page || (total && perPage ? Math.ceil(total / perPage) : undefined);
      if (!meta || (last && current >= last)) break;
    }
  }

  // Фолбек: переглянемо останні 5 сторінок без пошуку (по 100)
  for (let page = 1; page <= 5; page++) {
    const r = await kcGet(`/pipelines/cards?page[size]=100&page[number]=${page}`);
    if (!r.ok) break;
    const items = extractItems(r.json);
    for (const it of items) {
      const id = String(it?.id ?? it?.card_id ?? "");
      const social = norm(it?.contact?.social_id ?? "");
      if (id && social && social === target) {
        return { id, via: "scan-latest" };
      }
    }
    const meta = r.json?.meta;
    const total = meta?.total || meta?.total_items;
    const perPage = meta?.per_page || meta?.page_size || 100;
    const current = meta?.current_page || page;
    const last = meta?.last_page || (total && perPage ? Math.ceil(total / perPage) : undefined);
    if (!meta || (last && current >= last)) break;
  }

  return { id: null, via: "not-found" };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") || "").trim();

  if (!username) {
    return NextResponse.json({ ok: false, error: "username required" }, { status: 400 });
  }

  const found = await findByContactSocialId(username);
  return NextResponse.json({
    ok: !!found.id,
    username,
    card_id: found.id,
    strategy: found.via,
  });
}
