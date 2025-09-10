// web/app/api/mc/ingest/route.ts
import { NextResponse } from "next/server";
import { kcFindCardIdByAny, kcMoveCard } from "@/lib/keycrm";

type MoveMap = {
  [key: string]: { to_pipeline_id: number; to_status_id: number; applied: "v1" | "v2" | "exp" };
};

// Налаштування тригерів (приклад)
const MOVE_BY_TEXT: MoveMap = {
  "1": { to_pipeline_id: 13, to_status_id: 130, applied: "v1" }, // Так
  "2": { to_pipeline_id: 13, to_status_id: 131, applied: "v2" }, // Ні
  "7днів": { to_pipeline_id: 13, to_status_id: 132, applied: "exp" },
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const username = body?.username || body?.ig_username || "";
    const fullName = body?.full_name || body?.fullname || body?.name || "";
    const text = String(body?.text ?? "").trim();

    // Пошук картки «розумний»
    const found = await kcFindCardIdByAny({ username, fullName });

    if (!found.ok || !found.card_id) {
      return NextResponse.json({
        ok: false,
        error: "card_not_found",
        hint:
          "Не знайшов лід у KeyCRM. Перевір, що title містить ПІБ (\"Чат з <Ім'я>\") або в contact.social_id збережено IG-логін.",
        debug: { username, fullName, text, found },
      });
    }

    // Визначаємо куди рухати за текстом
    const key = text.toLowerCase();
    const move = MOVE_BY_TEXT[key];
    if (!move) {
      return NextResponse.json({
        ok: true,
        note: "card_found_but_text_not_matched",
        found,
      });
    }

    const res = await kcMoveCard(found.card_id, move.to_pipeline_id, move.to_status_id);

    return NextResponse.json({
      ok: res.ok,
      applied: move.applied,
      move: { via: "PUT pipelines/cards/{id}", status: res.status },
      found,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ingest_failed" }, { status: 500 });
  }
}
