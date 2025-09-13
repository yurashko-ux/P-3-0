// app/api/debug/kv/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  await assertAdmin(req);

  const ts = Date.now();
  const testKey = `debug:kv:test:${ts}`;
  const testIndex = `debug:kv:index`;

  let setOk = false;
  let getValue: string | null = null;
  let zaddOk = false;
  let zrange: string[] = [];

  // kvSet(): Promise<void> → якщо await без помилки, вважаємо успішно
  try {
    await kvSet(testKey, "ping");
    setOk = true;
  } catch {}

  // kvGet(): Promise<any>
  try {
    getValue = await kvGet(testKey);
  } catch {}

  // kvZAdd(): Promise<void> → ставимо прапорець після успіху
  try {
    await kvZAdd(testIndex, ts, String(ts));
    zaddOk = true;
  } catch {}

  // kvZRange(): Promise<string[]>
  try {
    zrange = await kvZRange(testIndex, 0, -1);
  } catch {}

  return NextResponse.json({
    ok: true,
    testKey,
    setOk,
    getValue,
    zaddOk,
    zrange,
  });
}
