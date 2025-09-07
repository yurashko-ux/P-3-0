// web/app/api/campaigns/debug/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const runtime = 'nodejs';

function auth(url: URL, req: Request) {
  const pass = req.headers.get('x-admin-pass') ?? url.searchParams.get('pass') ?? '';
  return pass && process.env.ADMIN_PASS && pass === process.env.ADMIN_PASS;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!auth(url, req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const probeKey = 'debug:kv:probe';
    const ts = Date.now();
    await kv.set(probeKey, { ts });
    const probe = await kv.get<{ ts: number }>(probeKey);

    const ids = await kv.lrange<string>('campaign:ids', 0, -1);
    const head = ids.slice(0, 10);
    const sample = await Promise.all(head.map((id) => kv.get(`campaign:${id}`)));

    return NextResponse.json({
      ok: true,
      env_seen: {
        KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
        KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
        KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
      },
      probe: { wrote: ts, read: probe?.ts ?? null },
      list: { count: ids.length, head },
      sample,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500 });
  }
}
