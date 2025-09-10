// web/app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { readJsonSafe, normalizeManychatPayload } from "@/lib/mc";
import { ingestHandler } from "@/lib/ingest"; // ← твоя існуюча функція інжесту

export async function POST(req: Request) {
  try {
    const raw = await readJsonSafe(req);
    const norm = normalizeManychatPayload(raw); // { username, text, fullName }

    // Запускаємо твою існуючу логіку кампаній
    const result = await ingestHandler(norm);

    return NextResponse.json({
      ok: true,
      via: "manychat",
      normalized: norm,
      ingest: result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, via: "manychat", error: e?.message || "manychat_handler_failed" },
      { status: 500 }
    );
  }
}
