// web/app/api/keycrm/local/find/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

type Card = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name?: string | null;
  updated_at: string;
};

function parseMaybeJson<T = any>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

function normHandle(raw?: string | null) {
  if (!raw) return null;
  return String(raw).trim().replace(/^@/, "").toLowerCase();
}

function includesCI(hay: string | null | undefined, needle: string) {
  if (!hay) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/**
 * GET /api/keycrm/local/find?pipeline_id=1&status_id=38&username=myig&fullname=John%20Doe&limit=200
 * Пошук ПЕРШ за соц-ідентифікатором (instagram), потім fallback по ПІБ/тайтлу у межах базової пари.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pipeline_id = url.searchParams.get("pipeline_id");
  const status_id = url.searchParams.get("status_id");
  const username = url.searchParams.get("username") || "";
  const fullname = url.searchParams.get("fullname") || "";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200)));

  if (!pipeline_id || !status_id) {
    return NextResponse.json(
      { ok: false, error: "pipeline_id and status_id are required" },
      { status: 400 }
    );
  }

  const pairIndex = `kc:index:cards:${pipeline_id}:${status_id}`;

  // -------- 1) by instagram handle (пріоритетний)
  const handle = normHandle(username);
  if (handle) {
    const socialKeys = [
      `kc:index:social:instagram:${handle}`,
      `kc:index:social:instagram:@${handle}`,
    ];
    const seen = new Set<string>();
    for (const sk of socialKeys) {
      // беремо перші N елементів, а потім відфільтровуємо по парі
      const socialMembers = ((await kvZRange(sk, 0, limit - 1)) as any[]) ?? [];
      for (const mid of socialMembers) {
        const id = String(mid);
        if (seen.has(id)) continue;
        seen.add(id);
        const raw = await kvGet(`kc:card:${id}`);
        const card = parseMaybeJson<Card>(raw);
        if (!card) continue;
        if (
          String(card.pipeline_id ?? "") === String(pipeline_id) &&
          String(card.status_id ?? "") === String(status_id)
        ) {
          return NextResponse.json({ ok: true, source: "social", card });
        }
      }
    }
  }

  // -------- 2) fallback: fullname/title у межах пари
  if (fullname) {
    const members = ((await kvZRange(pairIndex, 0, limit - 1)) as any[]) ?? [];
    for (let i = members.length - 1; i >= 0; i--) {
      const id = String(members[i]);
      const raw = await kvGet(`kc:card:${id}`);
      const card = parseMaybeJson<Card>(raw);
      if (!card) continue;

      if (
        includesCI(card.contact_full_name ?? null, fullname) ||
        includesCI(card.title ?? "", fullname)
      ) {
        return NextResponse.json({ ok: true, source: "fullname/title", card });
      }
    }
  }

  return NextResponse.json({ ok: true, source: null, card: null });
}
