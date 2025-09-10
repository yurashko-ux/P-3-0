// web/app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { readJsonSafe, normalizeManychatPayload } from "@/lib/mc";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = await readJsonSafe(req);
    const norm = normalizeManychatPayload(raw);

    // Додаємо обидві ключові назви для сумісності з /api/mc/ingest
    const payload = {
      username: norm.username || "",
      text: norm.text || "",
      fullname: norm.fullName || raw?.full_name || raw?.name || "",
      full_name: norm.fullName || raw?.full_name || raw?.name || "",
    };

    // --- Авторизація ---
    const incomingAuth = req.headers.get("authorization");
    const tokenFromQS = url.searchParams.get("token");
    const tokenFromEnv = process.env.MC_TOKEN;

    let authHeader = incomingAuth || (tokenFromQS ? `Bearer ${tokenFromQS}` : "");
    if (!authHeader && tokenFromEnv) authHeader = `Bearer ${tokenFromEnv}`;

    // --- Vercel bypass (якщо ввімкнено Deployment Protection) ---
    const incomingBypass =
      req.headers.get("x-vercel-protection-bypass") ||
      req.headers.get("x-vercel-automation-bypass-secret");
    const bypassFromEnv =
      process.env.X_VERCEL_PROTECTION_BYPASS ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    // Готуємо URL для внутрішнього /api/mc/ingest
    const ingestUrl = new URL("/api/mc/ingest", req.url);

    // Дублюємо ?token у запит також (на випадок, якщо /ingest читає його з QS)
    if (tokenFromQS) ingestUrl.searchParams.set("token", tokenFromQS);
    else if (!incomingAuth && tokenFromEnv)
      ingestUrl.searchParams.set("token", tokenFromEnv);

    if (incomingBypass) {
      ingestUrl.searchParams.set("x-vercel-protection-bypass", incomingBypass);
    } else if (bypassFromEnv) {
      ingestUrl.searchParams.set("x-vercel-protection-bypass", bypassFromEnv);
    }

    const headers: HeadersInit = { "content-type": "application/json" };
    if (authHeader) headers["authorization"] = authHeader;
    if (incomingBypass) headers["x-vercel-protection-bypass"] = incomingBypass;
    else if (bypassFromEnv) headers["x-vercel-protection-bypass"] = bypassFromEnv;

    const fwd = await fetch(ingestUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await fwd.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      via: "manychat",
      normalized: payload,
      ingest: data,
      status: fwd.status,
      debug: {
        usedAuth: !!authHeader,
        usedQS: !!(tokenFromQS || tokenFromEnv),
        usedBypass: !!(incomingBypass || bypassFromEnv),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, via: "manychat", error: e?.message || "manychat_failed" },
      { status: 500 }
    );
  }
}
