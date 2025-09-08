// web/app/api/debug/kv/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN = process.env.ADMIN_PASS ?? '';

function okAuth(req: NextRequest) {
  const bearer = req.headers.get('authorization') || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const cookiePass = cookies().get('admin_pass')?.value || '';
  const pass = token || cookiePass;
  return !ADMIN || pass === ADMIN;
}

export async function GET(req: NextRequest) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const env = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    // діагностика можливих старих назв
    KV_URL: Boolean(process.env.KV_URL),
    KV_TOKEN: Boolean(process.env.KV_TOKEN),
  };

  const ts = Date.now();
  const testKey = `diag:kv:test:${ts}`;
  const testIndex = 'diag:kv:index';

  let setOk = false, getValue: string | null = null, zaddOk = false, zrange: string[] = [];

  try { setOk = await kvSet(testKey, 'ping'); } catch {}
  try { getValue = await kvGet(testKey); } catch {}
  try { zaddOk = await kvZAdd(testIndex, ts, String(ts)); } catch {}
  try { zrange = await kvZRange(testIndex, 0, -1); } catch {}

  const ok = Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN && setOk && getValue === 'ping');
  return NextResponse.json({
    ok,
    env,
    setOk,
    getValue,
    zaddOk,
    zrangeCount: Array.isArray(zrange) ? zrange.length : 0,
  });
}
