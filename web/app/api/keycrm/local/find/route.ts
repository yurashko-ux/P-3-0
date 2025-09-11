// web/app/api/keycrm/local/find/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

type Card = {
  id: number;
  title: string | null;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  updated_at: string | null;
};

const norm = (s?: string) => (s ?? "").trim();
const low = (s?: string) => norm(s).toLowerCase();
const stripAt = (s: string) => s.replace(/^@+/, "");

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null as any;
  try {
    const first = JSON.parse(raw);
    if (first && typeof first === "object" && typeof (first as any).value === "string") {
      try { return JSON.parse((first as any).value); } catch { return first as any; }
    }
    return first as any;
  } catch { return null as any; }
}

async function readCard(id: string): Promise<Card | null> {
  const raw = await kvGet(`kc:card:${id}`);
  const c = safeParse<Card>(raw);
  if (!c) return null;
  const pid = c.pipeline_id != null ? Number(c.pipeline_id) : null;
  const sid = c.status_id != null ? Number(c.status_id) : null;
  return {
    id: Number(id),
    title: c.title ?? null,
    pipeline_id: pid,
    status_id: sid,
    contact_social_name: c.contact_social_name ?? null,
    contact_social_id: c.contact_social_id ?? null,
    updated_at: c.updated_at ?? null,
  };
}

function matchesUsername(c: Card, username?: string): boolean {
  if (!username) return true;
  const u = stripAt(low(username));
  const social = stripAt(low(c.contact_social_id || ""));
  return !!u && !!social && u === social;
}

function matchesFullname(c: Card, fullName?: string): boolean {
  if (!fullName) return true;
  const t = norm(c.title || "");
  // Поширений формат у KeyCRM: "Чат з <ПІБ>"
  return t === `Чат з ${fullName}` || t.includes(fullName);
}

function matchesPipeStatus(c: Card, pid?: number, sid?: number): boolean {
  const okP = pid ? c.pipeline_id === pid : true;
  const okS = sid ? c.status_id === sid : true;
  return okP && okS;
}

function toScoreDate(c: Card): number {
  const s = c.updated_at ? c.updated_at : "";
  const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") + "Z" : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") || undefined;
    const fullname = url.searchParams.get("fullname") || url.searchParams.get("full_name") || undefined;
    const pipeline_id = url.searchParams.get("pipeline_id");
    const status_id = url.searchParams.get("status_id");

    const pid = pipeline_id ? Number(pipeline_id) : undefined;
    const sid = status_id ? Number(status_id) : undefined;

    // Кандидати:
    // 1) Якщо задані pipeline/status — беремо всі card_id з індексу kc:index:cards:<p>:<s>
    // 2) Інакше — шукаємо по IG: kc:index:social:instagram:<handle> (і з '@', і без)
    let candidateIds: string[] = [];

    if (pid && sid) {
      candidateIds = await kvZRange(`kc:index:cards:${pid}:${sid}`, 0, -1);
    } else if (username) {
      const handleNoAt = stripAt(username);
      const a = await kvZRange(`kc:index:social:instagram:${handleNoAt}`, 0, -1);
      const b = await kvZRange(`kc:index:social:instagram:@${handleNoAt}`, 0, -1);
      // унікальне об’єднання
      const set = new Set<string>([...a, ...b]);
      candidateIds = Array.from(set);
    }

    // Якщо індекси пусті, повертаємо підказку
    if (!candidateIds.length) {
      return NextResponse.json({
        ok: false,
        reason: "no_candidates_in_indexes",
        used: { username: username ?? null, fullname: fullname ?? null, pipeline_id: pid ?? null, status_id: sid ?? null },
      });
    }

    // Завантажуємо картки з KV і фільтруємо під умови
    const cards: Card[] = [];
    for (const id of candidateIds) {
      const card = await readCard(id);
      if (!card) continue;
      cards.push(card);
    }

    const filtered = cards
      .filter((c) => matchesPipeStatus(c, pid, sid))
      .filter((c) => matchesUsername(c, username))
      .filter((c) => matchesFullname(c, fullname))
      .sort((a, b) => toScoreDate(b) - toScoreDate(a)); // найсвіжіша вище

    const best = filtered[0] || null;

    return NextResponse.json({
      ok: !!best,
      total_candidates: candidateIds.length,
      filtered: filtered.length,
      card_id: best ? best.id : null,
      best,
      sample: filtered.slice(0, 5),
      used: { username: username ?? null, fullname: fullname ?? null, pipeline_id: pid ?? null, status_id: sid ?? null },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "local_find_failed" }, { status: 200 });
  }
}
