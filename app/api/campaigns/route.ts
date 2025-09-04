import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

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

  // SCOPE
  base_pipeline_id: number;
  base_status_id: number;
  base_pipeline_label?: string;
  base_status_label?: string;

  rule1?: Rule;
  rule2?: Rule;

  expire_days?: number;
  expire_to?: Omit<Rule, "value">;
};

function bad(msg: string, code = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: code });
}
function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
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

// GET: list (терпимо до змішаних форматів у KV)
export async function GET() {
  const map = await kv.hgetall(BUCKET).catch(() => null);
  const items: Campaign[] = map
    ? Object.values(map)
        .map(parseKV)
        .filter((x): x is Campaign => !!x)
    : [];

  items.sort((a, b) => {
    const ta = new Date(a.createdAt ?? 0).getTime() || 0;
    const tb = new Date(b.createdAt ?? 0).getTime() || 0;
    return tb - ta;
  });

  return NextResponse.json({ ok: true, items });
}

// POST: create (усі нові записи зберігаємо як рядок)
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  const base_pipeline_id = Number(body.base_pipeline_id);
  const base_status_id = Number(body.base_status_id);
  if (!Number.isFinite(base_pipeline_id) || !Number.isFinite(base_status_id)) {
    return bad("Scope required: base_pipeline_id & base_status_id");
  }

  const rule1 =
    body.rule1 &&
    isNum(Number(body.rule1?.to_pipeline_id)) &&
    isNum(Number(body.rule1?.to_status_id)) &&
    String(body.rule1?.value || "").trim()
      ? {
          value: String(body.rule1.value).trim(),
          to_pipeline_id: Number(body.rule1.to_pipeline_id),
          to_status_id: Number(body.rule1.to_status_id),
          to_pipeline_label: body.rule1.to_pipeline_label,
          to_status_label: body.rule1.to_status_label,
        }
      : undefined;

  const rule2 =
    body.rule2 &&
    isNum(Number(body.rule2?.to_pipeline_id)) &&
    isNum(Number(body.rule2?.to_status_id)) &&
    String(body.rule2?.value || "").trim()
      ? {
          value: String(body.rule2.value).trim(),
          to_pipeline_id: Number(body.rule2.to_pipeline_id),
          to_status_id: Number(body.rule2.to_status_id),
          to_pipeline_label: body.rule2.to_pipeline_label,
          to_status_label: body.rule2.to_status_label,
        }
      : undefined;

  const expire_days =
    body.expire_days != null ? Number(body.expire_days) : undefined;

  const expire_to =
    body.expire_to &&
    isNum(Number(body.expire_to?.to_pipeline_id)) &&
    isNum(Number(body.expire_to?.to_status_id))
      ? {
          to_pipeline_id: Number(body.expire_to.to_pipeline_id),
          to_status_id: Number(body.expire_to.to_status_id),
          to_pipeline_label: body.expire_to.to_pipeline_label,
          to_status_label: body.expire_to.to_status_label,
        }
      : undefined;

  if (!rule1 && !rule2 && !expire_days && !expire_to) {
    return bad("At least one rule or expire must be provided");
  }

  const item: Campaign = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    base_pipeline_id,
    base_status_id,
    base_pipeline_label: body.base_pipeline_label,
    base_status_label: body.base_status_label,
    rule1,
    rule2,
    expire_days: Number.isFinite(expire_days) ? expire_days : undefined,
    expire_to,
  };

  await kv.hset(BUCKET, { [item.id]: JSON.stringify(item) });

  return NextResponse.json({ ok: true, item });
}
