// web/app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { readJsonSafe, normalizeManychatPayload } from "@/lib/mc";

export async function POST(req: Request) {
  try {
    // 1) читаємо raw тіло з ManyChat навіть якщо воно прийшло як text/plain
    const raw = await readJsonSafe(req);

    // 2) нормалізуємо до { username, text, fullName }
    const norm = normalizeManychatPayload(raw);

    // 3) готуємо форвард на існуючий внутрішній ендпойнт /api/mc/ingest
    const ingestUrl = new URL("/api/mc/ingest", req.url);

    // якщо ManyChat не передає Authorization, підставимо наш секрет MC_TOKEN
    const incomingAuth = (req.headers.get("authorization") || "").trim();
    const headers: HeadersInit = { "content-type": "application/json" };
    if (incomingAuth) {
      headers["authorization"] = incomingAuth;
    } else if (process.env.MC_TOKEN) {
      headers["authorization"] = `Bearer ${process.env.MC_TOKEN}`;
    }

    // 4) форвардимо нормалізоване тіло на /api/mc/ingest
    const fwd = await fetch(ingestUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(norm),
    });

    const data = await fwd.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      via: "manychat",
      normalized: norm,
      ingest: data,
      status: fwd.status,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, via: "manychat", error: e?.message || "manychat_handler_failed" },
      { status: 500 }
    );
  }
}
