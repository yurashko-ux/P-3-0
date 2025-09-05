// app/api/mc/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function withCORS(init?: ResponseInit) {
  const h = new Headers(init?.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mc-pass");
  return h;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: withCORS() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCORS() });
}

export async function POST(req: NextRequest) {
  // 1) Авторизація: дозволяємо Bearer MC_TOKEN або Basic admin:ADMIN_PASS або x-mc-pass
  const MC_TOKEN = (process.env.MC_TOKEN || "").trim();
  const ADMIN_PASS = (process.env.ADMIN_PASS || "").trim();
  const ADMIN_USER = (process.env.ADMIN_USER || "admin").trim();

  const authZ = req.headers.get("authorization") || "";
  const xmc = (req.headers.get("x-mc-pass") || "").trim();

  let okAuth = false;

  // Bearer
  if (MC_TOKEN) {
    const bearer = authZ.startsWith("Bearer ") ? authZ.slice(7) : "";
    if (bearer && bearer === MC_TOKEN) okAuth = true;
    if (!okAuth && xmc && xmc === MC_TOKEN) okAuth = true;
  }

  // Basic admin:pass
  if (!okAuth && ADMIN_PASS) {
    if (authZ.startsWith("Basic ")) {
      const b64 = authZ.slice(6);
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const [u, p] = decoded.split(":");
        if (u === ADMIN_USER && p === ADMIN_PASS) okAuth = true;
      } catch {}
    }
  }

  if (!okAuth) return unauthorized();

  // 2) Тіло запиту
  let body: any = {};
  try { body = await req.json(); } catch {}
  const lead_id = Number(body?.lead_id);
  const text = String(body?.text ?? "").trim();
  const instagram_username = String(body?.instagram_username ?? body?.username ?? "").trim().toLowerCase();

  if (!Number.isFinite(lead_id) || !text) {
    return NextResponse.json(
      { ok: false, error: "lead_id (number) and text (string) are required" },
      { status: 400, headers: withCORS() }
    );
  }

  // 3) KEYCRM — НЕ ОБОВʼЯЗКОВО
  const KEYCRM_API_URL = String(process.env.KEYCRM_API_URL ?? "").replace(/\/+$/, "");
  const KEYCRM_BEARER   = String(process.env.KEYCRM_BEARER   ?? "").trim();

  // Якщо чогось із пари немає — просто приймаємо подію і нічого не форвардимо
  if (!KEYCRM_API_URL || !KEYCRM_BEARER) {
    return NextResponse.json({
      ok: true,
      accepted: { lead_id, instagram_username, text },
      mode: "noop",
      reason: "KEYCRM disabled (missing KEYCRM_API_URL or KEYCRM_BEARER)"
    }, { status: 200, headers: withCORS() });
  }

  // 4) Якщо обидва задані — тут вставиш свій реальний форвард у KeyCRM
  // Приклад-заглушка (щоб не ламати збірку і не вгадувати endpoint):
  // const resp = await fetch(`${KEYCRM_API_URL}/your-endpoint`, { ... });
  // const data = await resp.json().catch(()=> ({}));

  return NextResponse.json({
    ok: true,
    accepted: { lead_id, instagram_username, text },
    mode: "keycrm:skipped_stub"
  }, { status: 200, headers: withCORS() });
}
