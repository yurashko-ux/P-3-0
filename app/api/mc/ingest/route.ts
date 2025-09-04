import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const ADMIN_USER = "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const MC_TOKEN = process.env.MC_TOKEN || "";
const KEYCRM_API_URL = (process.env.KEYCRM_API_URL || "").replace(/\/+$/, "");
const KEYCRM_BEARER = process.env.KEYCRM_BEARER || "";
const ENABLE = (process.env.ENABLE_OBOYMA || "1") !== "0"; // фіча-флаг
const BUCKET = "campaigns";

type Rule = {
  value: string;
  to_pipeline_id: number;
  to_status_id: number;
  to_pipeline_label?: string;
  to_status_label?: string;
};
type Campaign = {
  id: string;
  createdAt: string;
  base_pipeline_id: number;
  base_status_id: number;
  base_pipeline_label?: string;
  base_status_label?: string;
  rule1?: Rule;
  rule2?: Rule;
  expire_days?: number;
  expire_to?: Omit<Rule, "value">;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
function unauthorized(msg = "Unauthorized") {
  return json({ ok: false, error: msg }, 401);
}
function bad(msg: string) {
  return json({ ok: false, error: msg }, 400);
}
function parseKV(v: unknown): Campaign | null {
  try {
    if (typeof v === "string") return JSON.parse(v) as Campaign;
    if (v && typeof v === "object") return v as Campaign;
    return null;
  } catch {
    return null;
  }
}
function fromBasic(auth?: string): { user: string; pass: string } | null {
  if (!auth?.startsWith("Basic ")) return null;
  try {
    const txt = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const [user, pass] = txt.split(":");
    return { user, pass };
  } catch {
    return null;
  }
}
function bearerOK(auth?: string) {
  return !!MC_TOKEN && !!auth && auth === `Bearer ${MC_TOKEN}`;
}

async function kfetch(path: string, init?: RequestInit) {
  if (!KEYCRM_API_URL || !KEYCRM_BEARER) {
    throw new Error("KEYCRM_NOT_CONFIGURED");
  }
  const url = `${KEYCRM_API_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${KEYCRM_BEARER}`,
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

export async function POST(req: Request) {
  if (!ENABLE) return json({ ok: false, error: "DISABLED" }, 503);

  // ── Auth: або Basic admin:ADMIN_PASS, або Bearer MC_TOKEN
  const auth = req.headers.get("authorization") || "";
  const b = fromBasic(auth);
  const okBasic = !!b && b.user === ADMIN_USER && b.pass === ADMIN_PASS;
  const okBearer = bearerOK(auth);
  if (!okBasic && !okBearer) return unauthorized();

  // ── Input
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  const lead_id = Number(body.lead_id ?? body.deal_id ?? body.id);
  // значення змінної може прийти під різними ключами — пробуємо всі поширені
  const incomingValue = String(
    body.var ?? body.value ?? body.change ?? body.mc_value ?? ""
  ).trim();

  if (!Number.isFinite(lead_id)) return bad("lead_id required (number)");
  if (!incomingValue) return bad("variable value required");

  // ── Тягнемо картку з KeyCRM
  let current: any = null;
  try {
    const { res, body } = await kfetch(`/deals/${lead_id}`, { method: "GET" });
    if (!res.ok) return json({ ok: false, step: "get_deal", status: res.status, body }, 502);
    current = body?.data || body;
  } catch (e: any) {
    return json({ ok: false, step: "get_deal", error: e?.message || String(e) }, 502);
  }

  const curPipeline = Number(current?.pipeline_id);
  const curStatus = Number(current?.status_id);

  // ── Кампанії
  const cmap = await kv.hgetall(BUCKET).catch(() => null);
  const campaigns: Campaign[] = cmap
    ? (Object.values(cmap).map(parseKV).filter(Boolean) as Campaign[])
    : [];

  // шукаємо кампанії, які відповідають SCОPE (база)
  const scoped = campaigns.filter(
    (c) =>
      Number(c.base_pipeline_id) === curPipeline &&
      Number(c.base_status_id) === curStatus
  );

  if (!scoped.length) {
    return json({
      ok: true,
      moved: false,
      reason: "scope_mismatch",
      current: { pipeline_id: curPipeline, status_id: curStatus },
      received: { value: incomingValue },
    });
  }

  // добираємо першу, де збігається правило
  let chosen: { campaign: Campaign; rule: Rule } | null = null;
  for (const c of scoped) {
    if (c.rule1 && String(c.rule1.value) === incomingValue) {
      chosen = { campaign: c, rule: c.rule1 };
      break;
    }
    if (c.rule2 && String(c.rule2.value) === incomingValue) {
      chosen = { campaign: c, rule: c.rule2 };
      break;
    }
  }

  if (!chosen) {
    return json({
      ok: true,
      moved: false,
      reason: "no_rule_match",
      campaigns_considered: scoped.map((c) => c.id),
      received: { value: incomingValue },
    });
  }

  // ── Переносимо картку
  const to = {
    pipeline_id: Number(chosen.rule.to_pipeline_id),
    status_id: Number(chosen.rule.to_status_id),
  };

  try {
    const { res, body } = await kfetch(`/deals/${lead_id}`, {
      method: "PATCH",
      body: JSON.stringify(to),
    });
    if (!res.ok) {
      return json(
        {
          ok: false,
          step: "move_deal",
          status: res.status,
          body,
          tried_to: to,
        },
        502
      );
    }
  } catch (e: any) {
    return json(
      { ok: false, step: "move_deal", error: e?.message || String(e), tried_to: to },
      502
    );
  }

  return json({
    ok: true,
    moved: true,
    campaign: chosen.campaign.id,
    from: { pipeline_id: curPipeline, status_id: curStatus },
    to,
    value: incomingValue,
  });
}
