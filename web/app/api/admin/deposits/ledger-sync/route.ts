// Реєстр завдатків проти знімка Altegio: GET — сухий прогін, POST — запис у реєстр.

import { NextRequest, NextResponse } from "next/server";
import { syncDepositLedger } from "@/lib/deposits/ledger-sync";
import { isDirectAdminAuthorizedAsync } from "@/lib/direct-admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest, apply: boolean) {
  if (!(await isDirectAdminAuthorizedAsync(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncDepositLedger({ apply })) });
  } catch (err) {
    console.error("[api/admin/deposits/ledger-sync] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка реєстру завдатків" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req, false);
}

export async function POST(req: NextRequest) {
  return run(req, true);
}
