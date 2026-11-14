// GET — процеси й люди Команди для конструктора; POST — новий процес.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, requireBusinessProcessesSection } from "@/lib/business-processes/require-auth";
import { createBusinessProcess, listBusinessProcesses } from "@/lib/business-processes/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireBusinessProcessesSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ ok: true, ...(await listBusinessProcesses()) });
  } catch (err) {
    console.error("[api/admin/business-processes] GET помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося завантажити процеси" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireBusinessProcessesSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const process = await createBusinessProcess(body, actorOf(auth));
    return NextResponse.json({ ok: true, process });
  } catch (err) {
    console.error("[api/admin/business-processes] POST помилка:", err);
    const message = err instanceof Error ? err.message : "Не вдалося створити процес";
    return NextResponse.json({ ok: false, error: message }, { status: /вкажіть|оберіть|додайте|напишіть|питання|можна|лише/i.test(message) ? 400 : 500 });
  }
}
