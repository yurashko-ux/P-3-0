// web/app/api/debug/kv/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is missing`);
  return v;
}

async function callRedis(cmd: string[]) {
  const url = must("KV_REST_API_URL");
  const token = must("KV_REST_API_TOKEN");

  const body = cmd.join(" ");
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
    cache: "no-store",
  });

  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: JSON.parse(text) };
  } catch {
    return { ok: r.ok, status: r.status, data: text };
  }
}

export async function GET() {
  try {
    // базові команди
    const ping = await callRedis(["PING"]);
    const set = await callRedis(["SET", "kv_test_key", "ok", "EX", "60"]);
    const get = await callRedis(["GET", "kv_test_key"]);

    // ZSET + вибірка
    const now = Date.now().toString();
    await callRedis(["DEL", "kv_test_idx"]);
    const zadd = await callRedis(["ZADD", "kv_test_idx", now, "id:1"]);
    const zrange = await callRedis(["ZRANGE", "kv_test_idx", "0", "-1"]);

    return NextResponse.json({
      ok: true,
      env: {
        has_KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        has_KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        has_KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
        has_REDIS_URL: !!process.env.REDIS_URL,
        has_KV_URL: !!process.env.KV_URL,
      },
      results: { ping, set, get, zadd, zrange },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
