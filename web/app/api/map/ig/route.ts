// web/app/api/map/ig/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normUsername(u?: string) {
  if (!u) return "";
  return u.trim().replace(/^@/, "").toLowerCase();
}

function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  // Адмін-guard
  await assertAdmin(req);

  // Парсимо body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  // Дістаємо та нормалізуємо значення
  const username = normUsername(body?.username);
  const card_id_raw = body?.card_id ?? body?.cardId ?? body?.card;

  // Валідація
  if (!username) return bad(400, "username is required");
  if (
    card_id_raw == null ||
    (typeof card_id_raw !== "string" && typeof card_id_raw !== "number")
  ) {
    return bad(400, "card_id is required");
  }

  const card_id = String(card_id_raw);
  const key = `map:ig:${username}`;

  // kvSet повертає void → просто викликаємо й повертаємо успіх
  await kvSet(key, card_id);

  return ok({ username, card_id });
}
