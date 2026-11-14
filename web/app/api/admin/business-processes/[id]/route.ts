// PUT — зміна процесу (нова версія, якщо змінились налаштування) або лише вмикання; DELETE — видалення.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, requireBusinessProcessesSection } from "@/lib/business-processes/require-auth";
import {
  deleteBusinessProcess,
  setBusinessProcessActive,
  updateBusinessProcess,
} from "@/lib/business-processes/store";

export const dynamic = "force-dynamic";

const USER_ERROR = /вкажіть|оберіть|додайте|напишіть|питання|можна|лише|не знайдено/i;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBusinessProcessesSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    // Лише перемикач «увімкнено» — без перевірки всієї форми.
    const onlyToggle = Object.keys(body).length === 1 && typeof body.isActive === "boolean";
    const process = onlyToggle
      ? await setBusinessProcessActive(params.id, body.isActive)
      : await updateBusinessProcess(params.id, body, actorOf(auth));
    return NextResponse.json({ ok: true, process });
  } catch (err) {
    console.error(`[api/admin/business-processes/${params.id}] PUT помилка:`, err);
    const message = err instanceof Error ? err.message : "Не вдалося зберегти процес";
    return NextResponse.json({ ok: false, error: message }, { status: USER_ERROR.test(message) ? 400 : 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBusinessProcessesSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteBusinessProcess(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/admin/business-processes/${params.id}] DELETE помилка:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося видалити процес" },
      { status: 500 },
    );
  }
}
